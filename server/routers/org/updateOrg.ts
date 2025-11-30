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
import license from "#dynamic/license/license";
import { getOrgTierData } from "#dynamic/lib/billing";
import { TierId } from "@server/lib/billing/tiers";
import { cache } from "@server/lib/cache";

const updateOrgParamsSchema = z
    .object({
        orgId: z.string()
    })
    .strict();

const updateOrgBodySchema = z
    .object({
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
            .optional()
    })
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
        message: "At least one field must be provided for update"
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
    responses: {}
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

        const isLicensed = await isLicensedOrSubscribed(orgId);
        if (build == "enterprise" && !isLicensed) {
            parsedBody.data.requireTwoFactor = undefined;
            parsedBody.data.maxSessionLengthHours = undefined;
            parsedBody.data.passwordExpiryDays = undefined;
        }

        const { tier } = await getOrgTierData(orgId);
        if (
            build == "saas" &&
            tier != TierId.STANDARD &&
            parsedBody.data.settingsLogRetentionDaysRequest &&
            parsedBody.data.settingsLogRetentionDaysRequest > 30
        ) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "You are not allowed to set log retention days greater than 30 with your current subscription"
                )
            );
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
                    parsedBody.data.settingsLogRetentionDaysAction
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
        cache.del(`org_${orgId}_retentionDays`);
        cache.del(`org_${orgId}_actionDays`);
        cache.del(`org_${orgId}_accessDays`);

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

async function isLicensedOrSubscribed(orgId: string): Promise<boolean> {
    if (build === "enterprise") {
        const isUnlocked = await license.isUnlocked();
        if (!isUnlocked) {
            return false;
        }
    }

    if (build === "saas") {
        const { tier } = await getOrgTierData(orgId);
        const subscribed = tier === TierId.STANDARD;
        if (!subscribed) {
            return false;
        }
    }

    return true;
}
