import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, logsDb, statusHistory } from "@server/db";
import {
    siteProvisioningKeys,
    siteProvisioningKeyOrg,
    newts,
    orgs,
    roles,
    roleSites,
    sites
} from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { eq, and, sql } from "drizzle-orm";
import { fromError } from "zod-validation-error";
import { verifyPassword, hashPassword } from "@server/auth/password";
import {
    generateId,
    generateIdFromEntropySize
} from "@server/auth/sessions/app";
import { getUniqueSiteName } from "@server/db/names";
import moment from "moment";
import { build } from "@server/build";
import { usageService } from "@server/lib/billing/usageService";
import { LimitId } from "@server/lib/billing";
import { INSPECT_MAX_BYTES } from "buffer";
import { getNextAvailableClientSubnet } from "@server/lib/ip";

const bodySchema = z.object({
    provisioningKey: z.string().nonempty(),
    name: z.string().optional()
});

export type RegisterNewtBody = z.infer<typeof bodySchema>;

export type RegisterNewtResponse = {
    newtId: string;
    secret: string;
};

export async function registerNewt(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { provisioningKey, name } = parsedBody.data;

        // Keys are in the format "siteProvisioningKeyId.secret"
        const dotIndex = provisioningKey.indexOf(".");
        if (dotIndex === -1) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Invalid provisioning key format"
                )
            );
        }

        const provisioningKeyId = provisioningKey.substring(0, dotIndex);
        const provisioningKeySecret = provisioningKey.substring(dotIndex + 1);

        // Look up the provisioning key by ID, joining to get the orgId
        const [keyRecord] = await db
            .select({
                siteProvisioningKeyId:
                    siteProvisioningKeys.siteProvisioningKeyId,
                siteProvisioningKeyHash:
                    siteProvisioningKeys.siteProvisioningKeyHash,
                orgId: siteProvisioningKeyOrg.orgId,
                maxBatchSize: siteProvisioningKeys.maxBatchSize,
                numUsed: siteProvisioningKeys.numUsed,
                validUntil: siteProvisioningKeys.validUntil,
                approveNewSites: siteProvisioningKeys.approveNewSites
            })
            .from(siteProvisioningKeys)
            .innerJoin(
                siteProvisioningKeyOrg,
                eq(
                    siteProvisioningKeys.siteProvisioningKeyId,
                    siteProvisioningKeyOrg.siteProvisioningKeyId
                )
            )
            .where(
                eq(
                    siteProvisioningKeys.siteProvisioningKeyId,
                    provisioningKeyId
                )
            )
            .limit(1);

        if (!keyRecord) {
            return next(
                createHttpError(
                    HttpCode.UNAUTHORIZED,
                    "Invalid provisioning key"
                )
            );
        }

        // Verify the secret portion against the stored hash
        const validSecret = await verifyPassword(
            provisioningKeySecret,
            keyRecord.siteProvisioningKeyHash
        );
        if (!validSecret) {
            return next(
                createHttpError(
                    HttpCode.UNAUTHORIZED,
                    "Invalid provisioning key"
                )
            );
        }

        if (
            keyRecord.maxBatchSize &&
            keyRecord.numUsed >= keyRecord.maxBatchSize
        ) {
            return next(
                createHttpError(
                    HttpCode.UNAUTHORIZED,
                    "Provisioning key has reached its maximum usage"
                )
            );
        }

        if (
            keyRecord.validUntil &&
            new Date(keyRecord.validUntil) < new Date()
        ) {
            return next(
                createHttpError(
                    HttpCode.UNAUTHORIZED,
                    "Provisioning key has expired"
                )
            );
        }

        const { orgId } = keyRecord;

        // Verify the org exists
        const [org] = await db.select().from(orgs).where(eq(orgs.orgId, orgId));
        if (!org) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Organization not found")
            );
        }
        if (!org.subnet) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Organization subnet not found"
                )
            );
        }

        // SaaS billing check
        if (build == "saas") {
            const usage = await usageService.getUsage(orgId, LimitId.SITES);
            if (!usage) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        "No usage data found for this organization"
                    )
                );
            }
            const rejectSites = await usageService.checkLimitSet(
                orgId,
                LimitId.SITES,
                {
                    ...usage,
                    instantaneousValue: (usage.instantaneousValue || 0) + 1
                }
            );
            if (rejectSites) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "Site limit exceeded. Please upgrade your plan."
                    )
                );
            }
        }

        const niceId = await getUniqueSiteName(orgId);
        const newtId = generateId(15);
        const newtSecret = generateIdFromEntropySize(25);
        const secretHash = await hashPassword(newtSecret);

        let newSiteId: number | undefined;

        const { value: newClientAddress, release: releaseSubnetLock } =
            await getNextAvailableClientSubnet(orgId);
        try {
            await db.transaction(async (trx) => {
                let clientAddress = newClientAddress.split("/")[0];
                clientAddress = `${clientAddress}/${org.subnet!.split("/")[1]}`; // we want the block size of the whole org

                // Create the site (type "newt", name = niceId)
                const [newSite] = await trx
                    .insert(sites)
                    .values({
                        orgId,
                        name: name || niceId,
                        niceId,
                        address: clientAddress,
                        type: "newt",
                        dockerSocketEnabled: true,
                        status: keyRecord.approveNewSites
                            ? "approved"
                            : "pending"
                    })
                    .returning();

                await logsDb.insert(statusHistory).values({
                    entityType: "site",
                    entityId: newSite.siteId,
                    orgId: orgId,
                    status: "offline",
                    timestamp: Math.floor(Date.now() / 1000)
                });

                newSiteId = newSite.siteId;

                // Grant admin role access to the new site
                const [adminRole] = await trx
                    .select()
                    .from(roles)
                    .where(and(eq(roles.isAdmin, true), eq(roles.orgId, orgId)))
                    .limit(1);

                if (!adminRole) {
                    throw new Error(`Admin role not found for org ${orgId}`);
                }

                await trx.insert(roleSites).values({
                    roleId: adminRole.roleId,
                    siteId: newSite.siteId
                });

                // Create the newt for this site
                await trx.insert(newts).values({
                    newtId,
                    secretHash,
                    siteId: newSite.siteId,
                    dateCreated: moment().toISOString()
                });

                // Consume the provisioning key - cascade removes siteProvisioningKeyOrg
                await trx
                    .update(siteProvisioningKeys)
                    .set({
                        lastUsed: moment().toISOString(),
                        numUsed: sql`${siteProvisioningKeys.numUsed} + 1`
                    })
                    .where(
                        eq(
                            siteProvisioningKeys.siteProvisioningKeyId,
                            provisioningKeyId
                        )
                    );

                await usageService.add(orgId, LimitId.SITES, 1, trx);
            });
        } finally {
            await releaseSubnetLock();
        }

        logger.info(
            `Provisioned new site (ID: ${newSiteId}) and newt (ID: ${newtId}) for org ${orgId} via provisioning key ${provisioningKeyId}`
        );

        return response<RegisterNewtResponse>(res, {
            data: {
                newtId,
                secret: newtSecret
            },
            success: true,
            error: false,
            message: "Newt registered successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
