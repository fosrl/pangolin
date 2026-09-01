import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { newts, sites } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { deletePeer } from "../gerbil/peers";
import { fromError } from "zod-validation-error";
import { sendToClient } from "#dynamic/routers/ws";
import { OpenAPITags, registry } from "@server/openApi";
import { cleanupSiteAssociations } from "@server/lib/rebuildClientAssociations";
import { usageService } from "@server/lib/billing/usageService";
import { LimitId } from "@server/lib/billing";
import {
    deletePendingAssociatedResourcesForSite,
    exceedsSiteAssociatedResourceDeleteLimit,
    getPendingAssociatedResourceCountForSite,
    runDeleteSiteAssociatedResourcesSideEffects,
    MAX_SITE_ASSOCIATED_RESOURCES_FOR_BULK_DELETE,
    type DeleteSiteAssociatedResourcesSideEffects
} from "@server/lib/deleteSiteAssociatedResources";

const rejectSiteParamsSchema = z.strictObject({
    siteId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "post",
    path: "/site/{siteId}/reject",
    description:
        "Reject a pending site by deleting it and any associated resources that are still pending.",
    tags: [OpenAPITags.Site],
    request: {
        params: rejectSiteParamsSchema
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

export async function rejectSite(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = rejectSiteParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { siteId } = parsedParams.data;

        const [site] = await db
            .select()
            .from(sites)
            .where(eq(sites.siteId, siteId))
            .limit(1);

        if (!site) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Site with ID ${siteId} not found`
                )
            );
        }

        if (!site.orgId) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    `Site with ID ${siteId} has no organization`
                )
            );
        }

        const pendingAssociatedResourceCount =
            await getPendingAssociatedResourceCountForSite(siteId, site.orgId);

        if (
            exceedsSiteAssociatedResourceDeleteLimit(
                pendingAssociatedResourceCount
            )
        ) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    `Cannot reject site and associated pending resources when the site has more than ${MAX_SITE_ASSOCIATED_RESOURCES_FOR_BULK_DELETE} pending resources`
                )
            );
        }

        const [deletedNewt] = await db
            .select()
            .from(newts)
            .where(eq(newts.siteId, siteId))
            .limit(1);

        let resourceSideEffects: DeleteSiteAssociatedResourcesSideEffects = {
            resources: [],
            siteResources: []
        };

        await db.transaction(async (trx) => {
            resourceSideEffects = await deletePendingAssociatedResourcesForSite(
                siteId,
                site.orgId,
                trx
            );

            if (resourceSideEffects.resources.length > 0) {
                await usageService.add(
                    site.orgId,
                    LimitId.PUBLIC_RESOURCES,
                    -resourceSideEffects.resources.length,
                    trx
                );
            }

            if (resourceSideEffects.siteResources.length > 0) {
                await usageService.add(
                    site.orgId,
                    LimitId.PRIVATE_RESOURCES,
                    -resourceSideEffects.siteResources.length,
                    trx
                );
            }
        });

        await runDeleteSiteAssociatedResourcesSideEffects(resourceSideEffects);

        await db.transaction(async (trx) => {
            if (site.type == "wireguard") {
                if (site.pubKey) {
                    await deletePeer(site.exitNodeId!, site.pubKey);
                }
            } else if (site.type == "newt") {
                await cleanupSiteAssociations(site, trx);
            }

            await trx.delete(sites).where(eq(sites.siteId, siteId));
            await usageService.add(site.orgId, LimitId.SITES, -1, trx);
        });

        if (deletedNewt) {
            const payload = {
                type: `newt/wg/terminate`,
                data: {}
            };
            sendToClient(deletedNewt.newtId, payload).catch((error) => {
                logger.error(
                    "Failed to send termination message to newt:",
                    error
                );
            });
        }

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Site rejected successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        if (createHttpError.isHttpError(error)) {
            return next(error);
        }
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
