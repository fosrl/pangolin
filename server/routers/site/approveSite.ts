import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
    db,
    resources,
    siteNetworks,
    siteResources,
    sites,
    type Site,
    type SiteResource
} from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import {
    getResourceIdsForSite,
    getSiteResourceIdsForSite
} from "@server/lib/deleteSiteAssociatedResources";
import {
    handleMessagingForUpdatedSiteResource,
    rebuildClientAssociationsFromSiteResource,
    waitForSiteResourceRebuildIdle
} from "@server/lib/rebuildClientAssociations";

const approveSiteParamsSchema = z.strictObject({
    siteId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "post",
    path: "/site/{siteId}/approve",
    description:
        "Approve a pending site and approve (and enable when needed) its associated resources.",
    tags: [OpenAPITags.Site],
    request: {
        params: approveSiteParamsSchema
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

type SiteResourceEnableSideEffect = {
    existing: SiteResource;
    updated: SiteResource;
    siteIds: number[];
};

export async function approveSite(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = approveSiteParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { siteId } = parsedParams.data;

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

        if (!existingSite.orgId) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    `Site with ID ${siteId} has no organization`
                )
            );
        }

        const orgId = existingSite.orgId;
        let updatedSite: Site | undefined;
        const siteResourceEnableSideEffects: SiteResourceEnableSideEffect[] =
            [];

        await db.transaction(async (trx) => {
            [updatedSite] = await trx
                .update(sites)
                .set({ status: "approved" })
                .where(eq(sites.siteId, siteId))
                .returning();

            const resourceIds = await getResourceIdsForSite(siteId, trx);
            const siteResourceIds = await getSiteResourceIdsForSite(
                siteId,
                orgId,
                trx
            );

            if (resourceIds.length > 0) {
                const pendingDisabledResources = await trx
                    .select({ resourceId: resources.resourceId })
                    .from(resources)
                    .where(
                        and(
                            inArray(resources.resourceId, resourceIds),
                            eq(resources.status, "pending"),
                            eq(resources.enabled, false)
                        )
                    );

                await trx
                    .update(resources)
                    .set({ status: "approved" })
                    .where(inArray(resources.resourceId, resourceIds));

                if (pendingDisabledResources.length > 0) {
                    await trx
                        .update(resources)
                        .set({ enabled: true })
                        .where(
                            inArray(
                                resources.resourceId,
                                pendingDisabledResources.map(
                                    (r) => r.resourceId
                                )
                            )
                        );
                }
            }

            if (siteResourceIds.length > 0) {
                const existingSiteResources = await trx
                    .select()
                    .from(siteResources)
                    .where(
                        inArray(siteResources.siteResourceId, siteResourceIds)
                    );

                const pendingDisabledSiteResources =
                    existingSiteResources.filter(
                        (sr) => sr.status === "pending" && !sr.enabled
                    );

                await trx
                    .update(siteResources)
                    .set({ status: "approved" })
                    .where(
                        inArray(siteResources.siteResourceId, siteResourceIds)
                    );

                if (pendingDisabledSiteResources.length > 0) {
                    const enableIds = pendingDisabledSiteResources.map(
                        (sr) => sr.siteResourceId
                    );

                    const updatedEnabledSiteResources = await trx
                        .update(siteResources)
                        .set({ enabled: true })
                        .where(inArray(siteResources.siteResourceId, enableIds))
                        .returning();

                    for (const updated of updatedEnabledSiteResources) {
                        const existing = pendingDisabledSiteResources.find(
                            (sr) => sr.siteResourceId === updated.siteResourceId
                        );
                        if (!existing || !updated.networkId) {
                            continue;
                        }

                        const networkSites = await trx
                            .select({ siteId: siteNetworks.siteId })
                            .from(siteNetworks)
                            .where(
                                eq(siteNetworks.networkId, updated.networkId)
                            );

                        siteResourceEnableSideEffects.push({
                            existing,
                            updated,
                            siteIds: networkSites.map((s) => s.siteId)
                        });
                    }
                }
            }
        });

        for (const sideEffect of siteResourceEnableSideEffects) {
            rebuildClientAssociationsFromSiteResource(sideEffect.updated)
                .then(() =>
                    waitForSiteResourceRebuildIdle(
                        sideEffect.updated.siteResourceId
                    )
                )
                .then(() =>
                    handleMessagingForUpdatedSiteResource(
                        sideEffect.existing,
                        sideEffect.updated,
                        sideEffect.siteIds,
                        sideEffect.siteIds
                    )
                )
                .catch((e) => {
                    logger.error(
                        `Failed to rebuild and handle messaging for site resource ${sideEffect.updated.siteResourceId} after site approval:`,
                        e
                    );
                });
        }

        return response(res, {
            data: updatedSite ?? null,
            success: true,
            error: false,
            message: "Site approved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
