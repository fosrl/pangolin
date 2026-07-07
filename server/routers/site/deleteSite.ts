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
import { ActionsEnum, checkUserActionPermission } from "@server/auth/actions";
import {
    deleteAssociatedResourcesForSite,
    exceedsSiteAssociatedResourceDeleteLimit,
    getAssociatedResourceCountForSite,
    runDeleteSiteAssociatedResourcesSideEffects,
    MAX_SITE_ASSOCIATED_RESOURCES_FOR_BULK_DELETE,
    type DeleteSiteAssociatedResourcesSideEffects
} from "@server/lib/deleteSiteAssociatedResources";

const deleteSiteSchema = z.strictObject({
    siteId: z.coerce.number().int().positive()
});

const deleteSiteQuerySchema = z.strictObject({
    deleteResources: z
        .enum(["true", "false"])
        .transform((v) => v === "true")
        .optional()
        .catch(false)
        .openapi({
            type: "boolean",
            description:
                "When true, also deletes all public and private resources associated with this site"
        })
});

registry.registerPath({
    method: "delete",
    path: "/site/{siteId}",
    description: "Delete a site and all its associated data.",
    tags: [OpenAPITags.Site],
    request: {
        params: deleteSiteSchema,
        query: deleteSiteQuerySchema
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

export async function deleteSite(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = deleteSiteSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const parsedQuery = deleteSiteQuerySchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error).toString()
                )
            );
        }

        const { siteId } = parsedParams.data;
        const { deleteResources } = parsedQuery.data;

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

        if (deleteResources) {
            const canDeletePublic = await checkUserActionPermission(
                ActionsEnum.deleteResource,
                req
            );
            const canDeletePrivate = await checkUserActionPermission(
                ActionsEnum.deleteSiteResource,
                req
            );

            if (!canDeletePublic || !canDeletePrivate) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "User does not have permission to delete associated resources"
                    )
                );
            }

            const associatedResourceCount =
                await getAssociatedResourceCountForSite(siteId, site.orgId);

            if (
                exceedsSiteAssociatedResourceDeleteLimit(
                    associatedResourceCount
                )
            ) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        `Cannot delete site and associated resources when the site has more than ${MAX_SITE_ASSOCIATED_RESOURCES_FOR_BULK_DELETE} resources`
                    )
                );
            }
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
            if (deleteResources) {
                resourceSideEffects = await deleteAssociatedResourcesForSite(
                    siteId,
                    site.orgId,
                    trx
                );
            }

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

        if (deleteResources) {
            await runDeleteSiteAssociatedResourcesSideEffects(
                resourceSideEffects
            );
        }

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
            message: "Site deleted successfully",
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
