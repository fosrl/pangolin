import { eq, sql, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import * as fs from "fs/promises";
import * as path from "path";
import {
    db,
    usage,
    customers,
    sites,
    newts,
    limits,
    Usage,
    Limit,
    Transaction
} from "@server/db";
import { FeatureId, getFeatureMeterId } from "./features";
import logger from "@server/logger";
import { sendToClient } from "#dynamic/routers/ws";
import { build } from "@server/build";
import { s3Client } from "@server/lib/s3";
import cache from "@server/lib/cache"; 

interface StripeEvent {
    identifier?: string;
    timestamp: number;
    event_name: string;
    payload: {
        value: number;
        stripe_customer_id: string;
    };
}

export function noop() {
    if (
        build !== "saas" ||
        !process.env.S3_BUCKET ||
        !process.env.LOCAL_FILE_PATH
    ) {
        return true;
    }
    return false;
}

export class UsageService {
    private bucketName: string | undefined;
    private currentEventFile: string | null = null;
    private currentFileStartTime: number = 0;
    private eventsDir: string | undefined;
    private uploadingFiles: Set<string> = new Set();

    constructor() {
        if (noop()) {
            return;
        }
        // this.bucketName = privateConfig.getRawPrivateConfig().stripe?.s3Bucket;
        // this.eventsDir = privateConfig.getRawPrivateConfig().stripe?.localFilePath;
        this.bucketName = process.env.S3_BUCKET || undefined;
        this.eventsDir = process.env.LOCAL_FILE_PATH || undefined;

        // Ensure events directory exists
        this.initializeEventsDirectory().then(() => {
            this.uploadPendingEventFilesOnStartup();
        });

        // Periodically check for old event files to upload
        setInterval(() => {
            this.uploadOldEventFiles().catch((err) => {
                logger.error("Error in periodic event file upload:", err);
            });
        }, 30000); // every 30 seconds
    }

    /**
     * Truncate a number to 11 decimal places to prevent precision issues
     */
    private truncateValue(value: number): number {
        return Math.round(value * 100000000000) / 100000000000; // 11 decimal places
    }

    private async initializeEventsDirectory(): Promise<void> {
        if (!this.eventsDir) {
            logger.warn(
                "Stripe local file path is not configured, skipping events directory initialization."
            );
            return;
        }
        try {
            await fs.mkdir(this.eventsDir, { recursive: true });
        } catch (error) {
            logger.error("Failed to create events directory:", error);
        }
    }

    private async uploadPendingEventFilesOnStartup(): Promise<void> {
        if (!this.eventsDir || !this.bucketName) {
            logger.warn(
                "Stripe local file path or bucket name is not configured, skipping leftover event file upload."
            );
            return;
        }
        try {
            const files = await fs.readdir(this.eventsDir);
            for (const file of files) {
                if (file.endsWith(".json")) {
                    const filePath = path.join(this.eventsDir, file);
                    try {
                        const fileContent = await fs.readFile(
                            filePath,
                            "utf-8"
                        );
                        const events = JSON.parse(fileContent);
                        if (Array.isArray(events) && events.length > 0) {
                            // Upload to S3
                            const uploadCommand = new PutObjectCommand({
                                Bucket: this.bucketName,
                                Key: file,
                                Body: fileContent,
                                ContentType: "application/json"
                            });
                            await s3Client.send(uploadCommand);

                            // Check if file still exists before unlinking
                            try {
                                await fs.access(filePath);
                                await fs.unlink(filePath);
                            } catch (unlinkError) {
                                logger.debug(
                                    `Startup file ${file} was already deleted`
                                );
                            }

                            logger.info(
                                `Uploaded leftover event file ${file} to S3 with ${events.length} events`
                            );
                        } else {
                            // Remove empty file
                            try {
                                await fs.access(filePath);
                                await fs.unlink(filePath);
                            } catch (unlinkError) {
                                logger.debug(
                                    `Empty startup file ${file} was already deleted`
                                );
                            }
                        }
                    } catch (err) {
                        logger.error(
                            `Error processing leftover event file ${file}:`,
                            err
                        );
                    }
                }
            }
        } catch (error) {
            logger.error("Failed to scan for leftover event files");
        }
    }

    public async add(
        orgId: string,
        featureId: FeatureId,
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
                // Get subscription data for this org (with caching)
                const customerId = await this.getCustomerId(orgId, featureId);

                if (!customerId) {
                    logger.warn(
                        `No subscription data found for org ${orgId} and feature ${featureId}`
                    );
                    return null;
                }

                let usage;
                if (transaction) {
                    usage = await this.internalAddUsage(
                        orgId,
                        featureId,
                        value,
                        transaction
                    );
                } else {
                    await db.transaction(async (trx) => {
                        usage = await this.internalAddUsage(
                            orgId,
                            featureId,
                            value,
                            trx
                        );
                    });
                }

                // Log event for Stripe
                await this.logStripeEvent(featureId, value, customerId);

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
        orgId: string,
        featureId: FeatureId,
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
                latestValue: value,
                updatedAt: Math.floor(Date.now() / 1000)
            })
            .onConflictDoUpdate({
                target: usage.usageId,
                set: {
                    latestValue: sql`${usage.latestValue} + ${value}`
                }
            })
            .returning();

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

    async updateDaily(
        orgId: string,
        featureId: FeatureId,
        value?: number,
        customerId?: string
    ): Promise<void> {
        if (noop()) {
            return;
        }
        try {
            if (!customerId) {
                customerId =
                    (await this.getCustomerId(orgId, featureId)) || undefined;
                if (!customerId) {
                    logger.warn(
                        `No subscription data found for org ${orgId} and feature ${featureId}`
                    );
                    return;
                }
            }

            // Truncate value to 11 decimal places if provided
            if (value !== undefined && value !== null) {
                value = this.truncateValue(value);
            }

            const today = this.getTodayDateString();

            let currentUsage: Usage | null = null;

            await db.transaction(async (trx) => {
                // Get existing meter record
                const usageId = `${orgId}-${featureId}`;
                // Get current usage record
                [currentUsage] = await trx
                    .select()
                    .from(usage)
                    .where(eq(usage.usageId, usageId))
                    .limit(1);

                if (currentUsage) {
                    const lastUpdateDate = this.getDateString(
                        currentUsage.updatedAt
                    );
                    const currentRunningTotal = currentUsage.latestValue;
                    const lastDailyValue = currentUsage.instantaneousValue || 0;

                    if (value == undefined || value === null) {
                        value = currentUsage.instantaneousValue || 0;
                    }

                    if (lastUpdateDate === today) {
                        // Same day update: replace the daily value
                        // Remove old daily value from running total, add new value
                        const newRunningTotal = this.truncateValue(
                            currentRunningTotal - lastDailyValue + value
                        );

                        await trx
                            .update(usage)
                            .set({
                                latestValue: newRunningTotal,
                                instantaneousValue: value,
                                updatedAt: Math.floor(Date.now() / 1000)
                            })
                            .where(eq(usage.usageId, usageId));
                    } else {
                        // New day: add to running total
                        const newRunningTotal = this.truncateValue(
                            currentRunningTotal + value
                        );

                        await trx
                            .update(usage)
                            .set({
                                latestValue: newRunningTotal,
                                instantaneousValue: value,
                                updatedAt: Math.floor(Date.now() / 1000)
                            })
                            .where(eq(usage.usageId, usageId));
                    }
                } else {
                    // First record for this meter
                    const meterId = getFeatureMeterId(featureId);
                    const truncatedValue = this.truncateValue(value || 0);
                    await trx.insert(usage).values({
                        usageId,
                        featureId,
                        orgId,
                        meterId,
                        instantaneousValue: truncatedValue,
                        latestValue: truncatedValue,
                        updatedAt: Math.floor(Date.now() / 1000)
                    });
                }
            });

            await this.logStripeEvent(featureId, value || 0, customerId);
        } catch (error) {
            logger.error(
                `Failed to update daily usage for ${orgId}/${featureId}:`,
                error
            );
        }
    }

    private async getCustomerId(
        orgId: string,
        featureId: FeatureId
    ): Promise<string | null> {
        const cacheKey = `customer_${orgId}_${featureId}`;
        const cached = cache.get<string>(cacheKey);

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
                .where(eq(customers.orgId, orgId))
                .limit(1);

            if (!customer) {
                return null;
            }

            const customerId = customer.customerId;

            // Cache the result
            cache.set(cacheKey, customerId, 300); // 5 minute TTL

            return customerId;
        } catch (error) {
            logger.error(
                `Failed to get subscription data for ${orgId}/${featureId}:`,
                error
            );
            return null;
        }
    }

    private async logStripeEvent(
        featureId: FeatureId,
        value: number,
        customerId: string
    ): Promise<void> {
        // Truncate value to 11 decimal places before sending to Stripe
        const truncatedValue = this.truncateValue(value);

        const event: StripeEvent = {
            identifier: uuidv4(),
            timestamp: Math.floor(new Date().getTime() / 1000),
            event_name: featureId,
            payload: {
                value: truncatedValue,
                stripe_customer_id: customerId
            }
        };

        await this.writeEventToFile(event);
        await this.checkAndUploadFile();
    }

    private async writeEventToFile(event: StripeEvent): Promise<void> {
        if (!this.eventsDir || !this.bucketName) {
            logger.warn(
                "Stripe local file path or bucket name is not configured, skipping event file write."
            );
            return;
        }
        if (!this.currentEventFile) {
            this.currentEventFile = this.generateEventFileName();
            this.currentFileStartTime = Date.now();
        }

        const filePath = path.join(this.eventsDir, this.currentEventFile);

        try {
            let events: StripeEvent[] = [];

            // Try to read existing file
            try {
                const fileContent = await fs.readFile(filePath, "utf-8");
                events = JSON.parse(fileContent);
            } catch (error) {
                // File doesn't exist or is empty, start with empty array
                events = [];
            }

            // Add new event
            events.push(event);

            // Write back to file
            await fs.writeFile(filePath, JSON.stringify(events, null, 2));
        } catch (error) {
            logger.error("Failed to write event to file:", error);
        }
    }

    private async checkAndUploadFile(): Promise<void> {
        if (!this.currentEventFile) {
            return;
        }

        const now = Date.now();
        const fileAge = now - this.currentFileStartTime;

        // Check if file is at least 1 minute old
        if (fileAge >= 60000) {
            // 60 seconds
            await this.uploadFileToS3();
        }
    }

    private async uploadFileToS3(): Promise<void> {
        if (!this.bucketName || !this.eventsDir) {
            logger.warn(
                "Stripe local file path or bucket name is not configured, skipping S3 upload."
            );
            return;
        }
        if (!this.currentEventFile) {
            return;
        }

        const fileName = this.currentEventFile;
        const filePath = path.join(this.eventsDir, fileName);

        // Check if this file is already being uploaded
        if (this.uploadingFiles.has(fileName)) {
            logger.debug(
                `File ${fileName} is already being uploaded, skipping`
            );
            return;
        }

        // Mark file as being uploaded
        this.uploadingFiles.add(fileName);

        try {
            // Check if file exists before trying to read it
            try {
                await fs.access(filePath);
            } catch (error) {
                logger.debug(
                    `File ${fileName} does not exist, may have been already processed`
                );
                this.uploadingFiles.delete(fileName);
                // Reset current file if it was this file
                if (this.currentEventFile === fileName) {
                    this.currentEventFile = null;
                    this.currentFileStartTime = 0;
                }
                return;
            }

            // Check if file exists and has content
            const fileContent = await fs.readFile(filePath, "utf-8");
            const events = JSON.parse(fileContent);

            if (events.length === 0) {
                // No events to upload, just clean up
                try {
                    await fs.unlink(filePath);
                } catch (unlinkError) {
                    // File may have been already deleted
                    logger.debug(
                        `File ${fileName} was already deleted during cleanup`
                    );
                }
                this.currentEventFile = null;
                this.uploadingFiles.delete(fileName);
                return;
            }

            // Upload to S3
            const uploadCommand = new PutObjectCommand({
                Bucket: this.bucketName,
                Key: fileName,
                Body: fileContent,
                ContentType: "application/json"
            });

            await s3Client.send(uploadCommand);

            // Clean up local file - check if it still exists before unlinking
            try {
                await fs.access(filePath);
                await fs.unlink(filePath);
            } catch (unlinkError) {
                // File may have been already deleted by another process
                logger.debug(
                    `File ${fileName} was already deleted during upload`
                );
            }

            logger.info(
                `Uploaded ${fileName} to S3 with ${events.length} events`
            );

            // Reset for next file
            this.currentEventFile = null;
            this.currentFileStartTime = 0;
        } catch (error) {
            logger.error(`Failed to upload ${fileName} to S3:`, error);
        } finally {
            // Always remove from uploading set
            this.uploadingFiles.delete(fileName);
        }
    }

    private generateEventFileName(): string {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const uuid = uuidv4().substring(0, 8);
        return `events-${timestamp}-${uuid}.json`;
    }

    public async getUsage(
        orgId: string,
        featureId: FeatureId,
        trx: Transaction | typeof db = db
    ): Promise<Usage | null> {
        if (noop()) {
            return null;
        }

        const usageId = `${orgId}-${featureId}`;

        try {
            const [result] = await trx
                .select()
                .from(usage)
                .where(eq(usage.usageId, usageId))
                .limit(1);

            if (!result) {
                // Lets create one if it doesn't exist using upsert to handle race conditions
                logger.info(
                    `Creating new usage record for ${orgId}/${featureId}`
                );
                const meterId = getFeatureMeterId(featureId);

                try {
                    const [newUsage] = await trx
                        .insert(usage)
                        .values({
                            usageId,
                            featureId,
                            orgId,
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
                        `Insert failed for ${orgId}/${featureId}, attempting to fetch existing record:`,
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
                `Failed to get usage for ${orgId}/${featureId}:`,
                error
            );
            throw error;
        }
    }

    public async getUsageDaily(
        orgId: string,
        featureId: FeatureId
    ): Promise<Usage | null> {
        if (noop()) {
            return null;
        }
        await this.updateDaily(orgId, featureId); // Ensure daily usage is updated
        return this.getUsage(orgId, featureId);
    }

    public async forceUpload(): Promise<void> {
        await this.uploadFileToS3();
    }

    /**
     * Scan the events directory for files older than 1 minute and upload them if not empty.
     */
    private async uploadOldEventFiles(): Promise<void> {
        if (!this.eventsDir || !this.bucketName) {
            logger.warn(
                "Stripe local file path or bucket name is not configured, skipping old event file upload."
            );
            return;
        }
        try {
            const files = await fs.readdir(this.eventsDir);
            const now = Date.now();
            for (const file of files) {
                if (!file.endsWith(".json")) continue;

                // Skip files that are already being uploaded
                if (this.uploadingFiles.has(file)) {
                    logger.debug(
                        `Skipping file ${file} as it's already being uploaded`
                    );
                    continue;
                }

                const filePath = path.join(this.eventsDir, file);

                try {
                    // Check if file still exists before processing
                    try {
                        await fs.access(filePath);
                    } catch (accessError) {
                        logger.debug(`File ${file} does not exist, skipping`);
                        continue;
                    }

                    const stat = await fs.stat(filePath);
                    const age = now - stat.mtimeMs;
                    if (age >= 90000) {
                        // 1.5 minutes - Mark as being uploaded
                        this.uploadingFiles.add(file);

                        try {
                            const fileContent = await fs.readFile(
                                filePath,
                                "utf-8"
                            );
                            const events = JSON.parse(fileContent);
                            if (Array.isArray(events) && events.length > 0) {
                                // Upload to S3
                                const uploadCommand = new PutObjectCommand({
                                    Bucket: this.bucketName,
                                    Key: file,
                                    Body: fileContent,
                                    ContentType: "application/json"
                                });
                                await s3Client.send(uploadCommand);

                                // Check if file still exists before unlinking
                                try {
                                    await fs.access(filePath);
                                    await fs.unlink(filePath);
                                } catch (unlinkError) {
                                    logger.debug(
                                        `File ${file} was already deleted during interval upload`
                                    );
                                }

                                logger.info(
                                    `Interval: Uploaded event file ${file} to S3 with ${events.length} events`
                                );
                                // If this was the current event file, reset it
                                if (this.currentEventFile === file) {
                                    this.currentEventFile = null;
                                    this.currentFileStartTime = 0;
                                }
                            } else {
                                // Remove empty file
                                try {
                                    await fs.access(filePath);
                                    await fs.unlink(filePath);
                                } catch (unlinkError) {
                                    logger.debug(
                                        `Empty file ${file} was already deleted`
                                    );
                                }
                            }
                        } finally {
                            // Always remove from uploading set
                            this.uploadingFiles.delete(file);
                        }
                    }
                } catch (err) {
                    logger.error(
                        `Interval: Error processing event file ${file}:`,
                        err
                    );
                    // Remove from uploading set on error
                    this.uploadingFiles.delete(file);
                }
            }
        } catch (err) {
            logger.error("Interval: Failed to scan for event files:", err);
        }
    }

    public async checkLimitSet(
        orgId: string,
        kickSites = false,
        featureId?: FeatureId,
        usage?: Usage,
        trx: Transaction | typeof db = db
    ): Promise<boolean> {
        if (noop()) {
            return false;
        }
        // This method should check the current usage against the limits set for the organization
        // and kick out all of the sites on the org
        let hasExceededLimits = false;

        try {
            let orgLimits: Limit[] = [];
            if (featureId) {
                // Get all limits set for this organization
                orgLimits = await trx
                    .select()
                    .from(limits)
                    .where(
                        and(
                            eq(limits.orgId, orgId),
                            eq(limits.featureId, featureId)
                        )
                    );
            } else {
                // Get all limits set for this organization
                orgLimits = await trx
                    .select()
                    .from(limits)
                    .where(eq(limits.orgId, orgId));
            }

            if (orgLimits.length === 0) {
                logger.debug(`No limits set for org ${orgId}`);
                return false;
            }

            // Check each limit against current usage
            for (const limit of orgLimits) {
                let currentUsage: Usage | null;
                if (usage) {
                    currentUsage = usage;
                } else {
                    currentUsage = await this.getUsage(
                        orgId,
                        limit.featureId as FeatureId,
                        trx
                    );
                }

                const usageValue =
                    currentUsage?.instantaneousValue ||
                    currentUsage?.latestValue ||
                    0;
                logger.debug(
                    `Current usage for org ${orgId} on feature ${limit.featureId}: ${usageValue}`
                );
                logger.debug(
                    `Limit for org ${orgId} on feature ${limit.featureId}: ${limit.value}`
                );
                if (
                    currentUsage &&
                    limit.value !== null &&
                    usageValue > limit.value
                ) {
                    logger.debug(
                        `Org ${orgId} has exceeded limit for ${limit.featureId}: ` +
                            `${usageValue} > ${limit.value}`
                    );
                    hasExceededLimits = true;
                    break; // Exit early if any limit is exceeded
                }
            }

            // If any limits are exceeded, disconnect all sites for this organization
            if (hasExceededLimits && kickSites) {
                logger.warn(
                    `Disconnecting all sites for org ${orgId} due to exceeded limits`
                );

                // Get all sites for this organization
                const orgSites = await trx
                    .select()
                    .from(sites)
                    .where(eq(sites.orgId, orgId));

                // Mark all sites as offline and send termination messages
                const siteUpdates = orgSites.map((site) => site.siteId);

                if (siteUpdates.length > 0) {
                    // Send termination messages to newt sites
                    for (const site of orgSites) {
                        if (site.type === "newt") {
                            const [newt] = await trx
                                .select()
                                .from(newts)
                                .where(eq(newts.siteId, site.siteId))
                                .limit(1);

                            if (newt) {
                                const payload = {
                                    type: `newt/wg/terminate`,
                                    data: {
                                        reason: "Usage limits exceeded"
                                    }
                                };

                                // Don't await to prevent blocking
                                await sendToClient(newt.newtId, payload).catch(
                                    (error: any) => {
                                        logger.error(
                                            `Failed to send termination message to newt ${newt.newtId}:`,
                                            error
                                        );
                                    }
                                );
                            }
                        }
                    }

                    logger.info(
                        `Disconnected ${orgSites.length} sites for org ${orgId} due to exceeded limits`
                    );
                }
            }
        } catch (error) {
            logger.error(`Error checking limits for org ${orgId}:`, error);
        }

        return hasExceededLimits;
    }
}

export const usageService = new UsageService();
