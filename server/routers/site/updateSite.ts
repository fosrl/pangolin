import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, Site } from "@server/db";
import { sites } from "@server/db";
import { eq, and, ne } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";
import { tierMatrix, TierFeature } from "@server/lib/billing/tierMatrix";

const updateSiteParamsSchema = z.strictObject({
    siteId: z.coerce.number().int().positive()
});

const updateSiteBodySchema = z
    .strictObject({
        name: z.string().min(1).max(255).optional(),
        niceId: z.string().min(1).max(255).optional(),
        dockerSocketEnabled: z.boolean().optional(),
        status: z.enum(["pending", "approved"]).optional(),
        autoUpdateEnabled: z.boolean().optional(),
        autoUpdateOverrideOrg: z.boolean().optional()
    })
    .refine((data) => Object.keys(data).length > 0, {
        error: "At least one field must be provided for update"
    });

registry.registerPath({
    method: "post",
    path: "/site/{siteId}",
    description: "Update a site.",
    tags: [OpenAPITags.Site],
    request: {
        params: updateSiteParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: updateSiteBodySchema
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

export async function updateSite(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = updateSiteParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const parsedBody = updateSiteBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { siteId } = parsedParams.data;
        const updateData = parsedBody.data;

        const [existingSite] = await db
            .select()
            .from(sites)
            .where(eq(sites.siteId, siteId))
            .limit(1);

        if (!existingSite) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Site with ID ${siteId} not found`
                )
            );
        }

        // if niceId is provided, check if it's already in use by another site
        if (updateData.niceId) {
            const [existingSiteNiceIdOverlap] = await db
                .select()
                .from(sites)
                .where(
                    and(
                        eq(sites.niceId, updateData.niceId),
                        eq(sites.orgId, sites.orgId),
                        ne(sites.siteId, siteId)
                    )
                )
                .limit(1);

            if (existingSiteNiceIdOverlap) {
                return next(
                    createHttpError(
                        HttpCode.CONFLICT,
                        `A site with niceId "${updateData.niceId}" already exists`
                    )
                );
            }
        }

        const hasNewtAutoUpdateFeature = await isLicensedOrSubscribed(
            existingSite.orgId,
            tierMatrix[TierFeature.NewtAutoUpdate]
        );
        if (!hasNewtAutoUpdateFeature) {
            parsedBody.data.autoUpdateEnabled = false; // force it off
            parsedBody.data.autoUpdateOverrideOrg = false; // force it off
        }

        // // if remoteSubnets is provided, ensure it's a valid comma-separated list of cidrs
        // if (updateData.remoteSubnets) {
        //     const subnets = updateData.remoteSubnets
        //         .split(",")
        //         .map((s) => s.trim());
        //     for (const subnet of subnets) {
        //         if (!isValidCIDR(subnet)) {
        //             return next(
        //                 createHttpError(
        //                     HttpCode.BAD_REQUEST,
        //                     `Invalid CIDR format: ${subnet}`
        //                 )
        //             );
        //         }
        //     }
        // }

        const updatedSite = await db
            .update(sites)
            .set(updateData)
            .where(eq(sites.siteId, siteId))
            .returning();

        if (updatedSite.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Site with ID ${siteId} not found`
                )
            );
        }

        return response(res, {
            data: updatedSite[0],
            success: true,
            error: false,
            message: "Site updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
