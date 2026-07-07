import { eq, sql, and } from "drizzle-orm";
import {
    db,
    usage,
    customers,
    limits,
    Usage,
    Limit,
    Transaction,
    orgs
} from "@server/db";
import { LimitId, getFeatureMeterId } from "./features";
import logger from "@server/logger";
import { build } from "@server/build";
import { regionalCache as cache } from "#dynamic/lib/cache";

export function noop() {
    if (build !== "saas") {
        return true;
    }
    return false;
}

export class UsageService {
    constructor() {
        if (noop()) {
            return;
        }
    }

    /**
     * Truncate a number to 11 decimal places to prevent precision issues
     */
    private truncateValue(value: number): number {
        return Math.round(value * 100000000000) / 100000000000; // 11 decimal places
    }

    public async add(
        orgId: string,
        featureId: LimitId,
        value: number,
        transaction: any = null
    ): Promise<Usage | null> {
        if (noop()) {
            return null;
        }

        // Truncate value to 11 decimal places
        value = this.truncateValue(value);

        // Implement retry logic for deadlock handling
        const maxRetries = 3;
        let attempt = 0;

        while (attempt <= maxRetries) {
            try {
                let usage;
                if (transaction) {
                    const orgIdToUse = await this.getBillingOrg(
                        orgId,
                        transaction
                    );
                    usage = await this.internalAddUsage(
                        orgIdToUse,
                        featureId,
                        value,
                        transaction
                    );
                } else {
                    await db.transaction(async (trx) => {
                        const orgIdToUse = await this.getBillingOrg(orgId, trx);
                        usage = await this.internalAddUsage(
                            orgIdToUse,
                            featureId,
                            value,
                            trx
                        );
                    });
                }

                return usage || null;
            } catch (error: any) {
                // Check if this is a deadlock error
                const isDeadlock =
                    error?.code === "40P01" ||
                    error?.cause?.code === "40P01" ||
                    (error?.message && error.message.includes("deadlock"));

                if (isDeadlock && attempt < maxRetries) {
                    attempt++;
                    // Exponential backoff with jitter: 50-150ms, 100-300ms, 200-600ms
                    const baseDelay = Math.pow(2, attempt - 1) * 50;
                    const jitter = Math.random() * baseDelay;
                    const delay = baseDelay + jitter;

                    logger.warn(
                        `Deadlock detected for ${orgId}/${featureId}, retrying attempt ${attempt}/${maxRetries} after ${delay.toFixed(0)}ms`
                    );

                    await new Promise((resolve) => setTimeout(resolve, delay));
                    continue;
                }

                logger.error(
                    `Failed to add usage for ${orgId}/${featureId} after ${attempt} attempts:`,
                    error
                );
                break;
            }
        }

        return null;
    }

    private async internalAddUsage(
        orgId: string, // here the orgId is the billing org already resolved by getBillingOrg in updateCount
        featureId: LimitId,
        value: number,
        trx: Transaction
    ): Promise<Usage> {
        // Truncate value to 11 decimal places
        value = this.truncateValue(value);

        const usageId = `${orgId}-${featureId}`;
        const meterId = getFeatureMeterId(featureId);

        // Use upsert: insert if not exists, otherwise increment
        const [returnUsage] = await trx
            .insert(usage)
            .values({
                usageId,
                featureId,
                orgId,
                meterId,
                instantaneousValue: value || 0,
                latestValue: value || 0,
                updatedAt: Math.floor(Date.now() / 1000)
            })
            .onConflictDoUpdate({
                target: usage.usageId,
                set: {
                    instantaneousValue: sql`COALESCE(${usage.instantaneousValue}, 0) + ${value}`
                }
            })
            .returning();

        logger.debug(
            `Added usage for org ${orgId} feature ${featureId}: +${value}, new instantaneousValue: ${returnUsage.instantaneousValue}`
        );

        return returnUsage;
    }

    // Helper function to get today's date as string (YYYY-MM-DD)
    getTodayDateString(): string {
        return new Date().toISOString().split("T")[0];
    }

    // Helper function to get date string from Date object
    getDateString(date: number): string {
        return new Date(date * 1000).toISOString().split("T")[0];
    }

    async updateCount(
        orgId: string,
        featureId: LimitId,
        value?: number,
        customerId?: string
    ): Promise<void> {
        if (noop()) {
            return;
        }

        const orgIdToUse = await this.getBillingOrg(orgId);

        try {
            // Truncate value to 11 decimal places if provided
            if (value !== undefined && value !== null) {
                value = this.truncateValue(value);
            }

            let currentUsage: Usage | null = null;

            await db.transaction(async (trx) => {
                // Get existing meter record
                const usageId = `${orgIdToUse}-${featureId}`;
                // Get current usage record
                [currentUsage] = await trx
                    .select()
                    .from(usage)
                    .where(eq(usage.usageId, usageId))
                    .limit(1);

                if (currentUsage) {
                    await trx
                        .update(usage)
                        .set({
                            instantaneousValue: value,
                            updatedAt: Math.floor(Date.now() / 1000)
                        })
                        .where(eq(usage.usageId, usageId));
                } else {
                    // First record for this meter
                    const meterId = getFeatureMeterId(featureId);
                    await trx.insert(usage).values({
                        usageId,
                        featureId,
                        orgId: orgIdToUse,
                        meterId,
                        instantaneousValue: value || 0,
                        latestValue: value || 0,
                        updatedAt: Math.floor(Date.now() / 1000)
                    });
                }
            });

            // if (privateConfig.getRawPrivateConfig().flags.usage_reporting) {
            //     await this.logStripeEvent(featureId, value || 0, customerId);
            // }
        } catch (error) {
            logger.error(
                `Failed to update count usage for ${orgIdToUse}/${featureId}:`,
                error
            );
        }
    }

    private async getCustomerId(
        orgId: string,
        featureId: LimitId
    ): Promise<string | null> {
        const orgIdToUse = await this.getBillingOrg(orgId);

        const cacheKey = `customer_${orgIdToUse}_${featureId}`;
        const cached = await cache.get<string>(cacheKey);

        if (cached) {
            return cached;
        }

        try {
            // Query subscription data
            const [customer] = await db
                .select({
                    customerId: customers.customerId
                })
                .from(customers)
                .where(eq(customers.orgId, orgIdToUse))
                .limit(1);

            if (!customer) {
                return null;
            }

            const customerId = customer.customerId;

            // Cache the result
            await cache.set(cacheKey, customerId, 300); // 5 minute TTL

            return customerId;
        } catch (error) {
            logger.error(
                `Failed to get subscription data for ${orgIdToUse}/${featureId}:`,
                error
            );
            return null;
        }
    }

    public async getUsage(
        orgId: string,
        featureId: LimitId,
        trx: Transaction | typeof db = db
    ): Promise<Usage | null> {
        if (noop()) {
            return null;
        }

        let orgIdToUse = orgId;
        try {
            orgIdToUse = await this.getBillingOrg(orgId, trx);

            const usageId = `${orgIdToUse}-${featureId}`;

            const [result] = await trx
                .select()
                .from(usage)
                .where(eq(usage.usageId, usageId))
                .limit(1);

            if (!result) {
                // Lets create one if it doesn't exist using upsert to handle race conditions
                logger.info(
                    `Creating new usage record for ${orgIdToUse}/${featureId}`
                );
                const meterId = getFeatureMeterId(featureId);

                try {
                    const [newUsage] = await trx
                        .insert(usage)
                        .values({
                            usageId,
                            featureId,
                            orgId: orgIdToUse,
                            meterId,
                            latestValue: 0,
                            updatedAt: Math.floor(Date.now() / 1000)
                        })
                        .onConflictDoNothing()
                        .returning();

                    if (newUsage) {
                        return newUsage;
                    } else {
                        // Record was created by another process, fetch it
                        const [existingUsage] = await trx
                            .select()
                            .from(usage)
                            .where(eq(usage.usageId, usageId))
                            .limit(1);
                        return existingUsage || null;
                    }
                } catch (insertError) {
                    // Fallback: try to fetch existing record in case of any insert issues
                    logger.warn(
                        `Insert failed for ${orgIdToUse}/${featureId}, attempting to fetch existing record:`,
                        insertError
                    );
                    const [existingUsage] = await trx
                        .select()
                        .from(usage)
                        .where(eq(usage.usageId, usageId))
                        .limit(1);
                    return existingUsage || null;
                }
            }

            return result;
        } catch (error) {
            logger.error(
                `Failed to get usage for ${orgIdToUse}/${featureId}:`,
                error
            );
            if (process.env.NODE_ENV !== "development") {
                throw error;
            }
        }

        return null;
    }

    public async getBillingOrg(
        orgId: string,
        trx: Transaction | typeof db = db
    ): Promise<string> {
        let orgIdToUse = orgId;

        // get the org
        const [org] = await trx
            .select()
            .from(orgs)
            .where(eq(orgs.orgId, orgId))
            .limit(1);

        if (!org) {
            throw new Error(`Organization with ID ${orgId} not found`);
        }

        if (!org.isBillingOrg) {
            if (org.billingOrgId) {
                orgIdToUse = org.billingOrgId;
            } else {
                throw new Error(
                    `Organization ${orgId} is not a billing org and does not have a billingOrgId set`
                );
            }
        }

        return orgIdToUse;
    }

    public async checkLimitSet(
        orgId: string,
        featureId?: LimitId,
        usage?: Usage,
        trx: Transaction | typeof db = db
    ): Promise<boolean> {
        if (noop()) {
            return false;
        }

        // This method should check the current usage against the limits set for the organization
        // and kick out all of the sites on the org
        let hasExceededLimits = false;
        let orgIdToUse = orgId;
        try {
            orgIdToUse = await this.getBillingOrg(orgId, trx);

            let orgLimits: Limit[] = [];
            if (featureId) {
                // Get all limits set for this organization
                orgLimits = await trx
                    .select()
                    .from(limits)
                    .where(
                        and(
                            eq(limits.orgId, orgIdToUse),
                            eq(limits.featureId, featureId)
                        )
                    );
            } else {
                // Get all limits set for this organization
                orgLimits = await trx
                    .select()
                    .from(limits)
                    .where(eq(limits.orgId, orgIdToUse));
            }

            if (orgLimits.length === 0) {
                logger.debug(`No limits set for org ${orgIdToUse}`);
                return false;
            }

            // Check each limit against current usage
            for (const limit of orgLimits) {
                let currentUsage: Usage | null;
                if (usage) {
                    currentUsage = usage;
                } else {
                    currentUsage = await this.getUsage(
                        orgIdToUse,
                        limit.featureId as LimitId,
                        trx
                    );
                }

                const usageValue =
                    currentUsage?.instantaneousValue ||
                    currentUsage?.latestValue ||
                    0;
                logger.debug(
                    `Current usage for org ${orgIdToUse} on feature ${limit.featureId}: ${usageValue}`
                );
                logger.debug(
                    `Limit for org ${orgIdToUse} on feature ${limit.featureId}: ${limit.value}`
                );
                if (
                    currentUsage &&
                    limit.value !== null &&
                    usageValue > limit.value
                ) {
                    logger.debug(
                        `Org ${orgIdToUse} has exceeded limit for ${limit.featureId}: ` +
                            `${usageValue} > ${limit.value}`
                    );
                    hasExceededLimits = true;
                    break; // Exit early if any limit is exceeded
                }
            }
        } catch (error) {
            logger.error(`Error checking limits for org ${orgIdToUse}:`, error);
        }

        return hasExceededLimits;
    }
}

export const usageService = new UsageService();
