import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { orgs, users } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { build } from "@server/build";
import { cache } from "#dynamic/lib/cache";
import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";
import { TierFeature, tierMatrix } from "@server/lib/billing/tierMatrix";
import { getOrgTierData } from "#dynamic/lib/billing";

const updateOrgParamsSchema = z.strictObject({
    orgId: z.string()
});

const updateOrgBodySchema = z
    .strictObject({
        name: z.string().min(1).max(255).optional(),
        requireTwoFactor: z.boolean().optional(),
        maxSessionLengthHours: z.number().nullable().optional(),
        passwordExpiryDays: z.number().nullable().optional(),
        settingsLogRetentionDaysRequest: z
            .number()
            .min(build === "saas" ? 0 : -1)
            .optional(),
        settingsLogRetentionDaysAccess: z
            .number()
            .min(build === "saas" ? 0 : -1)
            .optional(),
        settingsLogRetentionDaysAction: z
            .number()
            .min(build === "saas" ? 0 : -1)
            .optional(),
        settingsLogRetentionDaysConnection: z
            .number()
            .min(build === "saas" ? 0 : -1)
            .optional(),
        settingsEnableGlobalNewtAutoUpdate: z.boolean().optional()
    })
    .refine((data) => Object.keys(data).length > 0, {
        error: "At least one field must be provided for update"
    });

registry.registerPath({
    method: "post",
    path: "/org/{orgId}",
    description: "Update an organization",
    tags: [OpenAPITags.Org],
    request: {
        params: updateOrgParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: updateOrgBodySchema
                }
            }
        }
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: z.object({
                        data: z.record(z.string(), z.any()).nullable(),
                        success: z.boolean(),
                        error: z.boolean(),
                        message: z.string(),
                        status: z.number()
                    })
                }
            }
        }
    }
});

export async function updateOrg(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = updateOrgParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const parsedBody = updateOrgBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { orgId } = parsedParams.data;

        // Check 2FA enforcement feature
        const has2FAFeature = await isLicensedOrSubscribed(
            orgId,
            tierMatrix[TierFeature.TwoFactorEnforcement]
        );
        if (!has2FAFeature) {
            parsedBody.data.requireTwoFactor = undefined;
        }

        // Check session duration policies feature
        const hasSessionDurationFeature = await isLicensedOrSubscribed(
            orgId,
            tierMatrix[TierFeature.SessionDurationPolicies]
        );
        if (!hasSessionDurationFeature) {
            parsedBody.data.maxSessionLengthHours = undefined;
        }

        // Check password expiration policies feature
        const hasPasswordExpirationFeature = await isLicensedOrSubscribed(
            orgId,
            tierMatrix[TierFeature.PasswordExpirationPolicies]
        );
        if (!hasPasswordExpirationFeature) {
            parsedBody.data.passwordExpiryDays = undefined;
        }

        const hasNewtAutoUpdateFeature = await isLicensedOrSubscribed(
            orgId,
            tierMatrix[TierFeature.NewtAutoUpdate]
        );
        if (!hasNewtAutoUpdateFeature) {
            parsedBody.data.settingsEnableGlobalNewtAutoUpdate = false; // force it off
        }

        if (build == "saas") {
            const { tier } = await getOrgTierData(orgId);

            // Determine max allowed retention days based on tier
            let maxRetentionDays: number | null = null;
            if (!tier) {
                maxRetentionDays = 3;
            } else if (tier === "tier1") {
                maxRetentionDays = 7;
            } else if (tier === "tier2") {
                maxRetentionDays = 30;
            } else if (tier === "tier3") {
                maxRetentionDays = 90;
            }
            // For enterprise tier, no check (maxRetentionDays remains null)

            if (maxRetentionDays !== null) {
                if (
                    parsedBody.data.settingsLogRetentionDaysRequest !==
                        undefined &&
                    parsedBody.data.settingsLogRetentionDaysRequest >
                        maxRetentionDays
                ) {
                    return next(
                        createHttpError(
                            HttpCode.FORBIDDEN,
                            `You are not allowed to set log retention days greater than ${maxRetentionDays} with your current subscription`
                        )
                    );
                }
                if (
                    parsedBody.data.settingsLogRetentionDaysAccess !==
                        undefined &&
                    parsedBody.data.settingsLogRetentionDaysAccess >
                        maxRetentionDays
                ) {
                    return next(
                        createHttpError(
                            HttpCode.FORBIDDEN,
                            `You are not allowed to set log retention days greater than ${maxRetentionDays} with your current subscription`
                        )
                    );
                }
                if (
                    parsedBody.data.settingsLogRetentionDaysAction !==
                        undefined &&
                    parsedBody.data.settingsLogRetentionDaysAction >
                        maxRetentionDays
                ) {
                    return next(
                        createHttpError(
                            HttpCode.FORBIDDEN,
                            `You are not allowed to set log retention days greater than ${maxRetentionDays} with your current subscription`
                        )
                    );
                }
                if (
                    parsedBody.data.settingsLogRetentionDaysConnection !==
                        undefined &&
                    parsedBody.data.settingsLogRetentionDaysConnection >
                        maxRetentionDays
                ) {
                    return next(
                        createHttpError(
                            HttpCode.FORBIDDEN,
                            `You are not allowed to set log retention days greater than ${maxRetentionDays} with your current subscription`
                        )
                    );
                }
            }
        }

        const updatedOrg = await db
            .update(orgs)
            .set({
                name: parsedBody.data.name,
                requireTwoFactor: parsedBody.data.requireTwoFactor,
                maxSessionLengthHours: parsedBody.data.maxSessionLengthHours,
                passwordExpiryDays: parsedBody.data.passwordExpiryDays,
                settingsLogRetentionDaysRequest:
                    parsedBody.data.settingsLogRetentionDaysRequest,
                settingsLogRetentionDaysAccess:
                    parsedBody.data.settingsLogRetentionDaysAccess,
                settingsLogRetentionDaysAction:
                    parsedBody.data.settingsLogRetentionDaysAction,
                settingsLogRetentionDaysConnection:
                    parsedBody.data.settingsLogRetentionDaysConnection,
                settingsEnableGlobalNewtAutoUpdate:
                    parsedBody.data.settingsEnableGlobalNewtAutoUpdate
            })
            .where(eq(orgs.orgId, orgId))
            .returning();

        if (updatedOrg.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Organization with ID ${orgId} not found`
                )
            );
        }

        // invalidate the cache for all of the orgs retention days
        await cache.del(`org_${orgId}_retentionDays`);
        await cache.del(`org_${orgId}_actionDays`);
        await cache.del(`org_${orgId}_accessDays`);
        await cache.del(`org_${orgId}_connectionDays`);

        return response(res, {
            data: updatedOrg[0],
            success: true,
            error: false,
            message: "Organization updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
