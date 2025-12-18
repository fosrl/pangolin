import { db, exitNodes, newts } from "@server/db";
import { orgs, roleSites, sites, userSites } from "@server/db";
import { remoteExitNodes } from "@server/db";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import response from "@server/lib/response";
import { and, count, eq, inArray, or, sql } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import semver from "semver";
import cache from "@server/lib/cache";

async function getLatestNewtVersion(): Promise<string | null> {
    try {
        const cachedVersion = cache.get<string>("latestNewtVersion");
        if (cachedVersion) {
            return cachedVersion;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1500); // Reduced timeout to 1.5 seconds

        const response = await fetch(
            "https://api.github.com/repos/fosrl/newt/tags",
            {
                signal: controller.signal
            }
        );

        clearTimeout(timeoutId);

        if (!response.ok) {
            logger.warn(
                `Failed to fetch latest Newt version from GitHub: ${response.status} ${response.statusText}`
            );
            return null;
        }

        const tags = await response.json();
        if (!Array.isArray(tags) || tags.length === 0) {
            logger.warn("No tags found for Newt repository");
            return null;
        }

        const latestVersion = tags[0].name;

        cache.set("latestNewtVersion", latestVersion);

        return latestVersion;
    } catch (error: any) {
        if (error.name === "AbortError") {
            logger.warn(
                "Request to fetch latest Newt version timed out (1.5s)"
            );
        } else if (error.cause?.code === "UND_ERR_CONNECT_TIMEOUT") {
            logger.warn(
                "Connection timeout while fetching latest Newt version"
            );
        } else {
            logger.warn(
                "Error fetching latest Newt version:",
                error.message || error
            );
        }
        return null;
    }
}

const listSitesParamsSchema = z.strictObject({
    orgId: z.string()
});

const listSitesSchema = z.object({
    limit: z
        .string()
        .optional()
        .default("1000")
        .transform(Number)
        .pipe(z.int().positive()),
    offset: z
        .string()
        .optional()
        .default("0")
        .transform(Number)
        .pipe(z.int().nonnegative())
});

function querySites(orgId: string, accessibleSiteIds: number[]) {
    return db
        .select({
            siteId: sites.siteId,
            niceId: sites.niceId,
            name: sites.name,
            pubKey: sites.pubKey,
            subnet: sites.subnet,
            megabytesIn: sites.megabytesIn,
            megabytesOut: sites.megabytesOut,
            orgName: orgs.name,
            type: sites.type,
            online: sites.online,
            address: sites.address,
            newtVersion: newts.version,
            exitNodeId: sites.exitNodeId,
            exitNodeName: exitNodes.name,
            exitNodeEndpoint: exitNodes.endpoint,
            remoteExitNodeId: remoteExitNodes.remoteExitNodeId
        })
        .from(sites)
        .leftJoin(orgs, eq(sites.orgId, orgs.orgId))
        .leftJoin(newts, eq(newts.siteId, sites.siteId))
        .leftJoin(exitNodes, eq(exitNodes.exitNodeId, sites.exitNodeId))
        .leftJoin(
            remoteExitNodes,
            eq(remoteExitNodes.exitNodeId, sites.exitNodeId)
        )
        .where(
            and(
                inArray(sites.siteId, accessibleSiteIds),
                eq(sites.orgId, orgId)
            )
        );
}

type SiteWithUpdateAvailable = Awaited<ReturnType<typeof querySites>>[0] & {
    newtUpdateAvailable?: boolean;
};

export type ListSitesResponse = {
    sites: SiteWithUpdateAvailable[];
    pagination: { total: number; limit: number; offset: number };
};

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/sites",
    description: "List all sites in an organization",
    tags: [OpenAPITags.Org, OpenAPITags.Site],
    request: {
        params: listSitesParamsSchema,
        query: listSitesSchema
    },
    responses: {}
});

export async function listSites(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = listSitesSchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error)
                )
            );
        }
        const { limit, offset } = parsedQuery.data;

        const parsedParams = listSitesParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error)
                )
            );
        }
        const { orgId } = parsedParams.data;

        if (req.user && orgId && orgId !== req.userOrgId) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not have access to this organization"
                )
            );
        }

        let accessibleSites;
        if (req.user) {
            accessibleSites = await db
                .select({
                    siteId: sql<number>`COALESCE(${userSites.siteId}, ${roleSites.siteId})`
                })
                .from(userSites)
                .fullJoin(roleSites, eq(userSites.siteId, roleSites.siteId))
                .where(
                    or(
                        eq(userSites.userId, req.user!.userId),
                        eq(roleSites.roleId, req.userOrgRoleId!)
                    )
                );
        } else {
            accessibleSites = await db
                .select({ siteId: sites.siteId })
                .from(sites)
                .where(eq(sites.orgId, orgId));
        }

        const accessibleSiteIds = accessibleSites.map((site) => site.siteId);
        const baseQuery = querySites(orgId, accessibleSiteIds);

        const countQuery = db
            .select({ count: count() })
            .from(sites)
            .where(
                and(
                    inArray(sites.siteId, accessibleSiteIds),
                    eq(sites.orgId, orgId)
                )
            );

        const sitesList = await baseQuery.limit(limit).offset(offset);
        const totalCountResult = await countQuery;
        const totalCount = totalCountResult[0].count;

        // Get latest version asynchronously without blocking the response
        const latestNewtVersionPromise = getLatestNewtVersion();

        const sitesWithUpdates: SiteWithUpdateAvailable[] = sitesList.map(
            (site) => {
                const siteWithUpdate: SiteWithUpdateAvailable = { ...site };
                // Initially set to false, will be updated if version check succeeds
                siteWithUpdate.newtUpdateAvailable = false;
                return siteWithUpdate;
            }
        );

        // Try to get the latest version, but don't block if it fails
        try {
            const latestNewtVersion = await latestNewtVersionPromise;

            if (latestNewtVersion) {
                sitesWithUpdates.forEach((site) => {
                    if (
                        site.type === "newt" &&
                        site.newtVersion &&
                        latestNewtVersion
                    ) {
                        try {
                            site.newtUpdateAvailable = semver.lt(
                                site.newtVersion,
                                latestNewtVersion
                            );
                        } catch (error) {
                            site.newtUpdateAvailable = false;
                        }
                    }
                });
            }
        } catch (error) {
            // Log the error but don't let it block the response
            logger.warn(
                "Failed to check for Newt updates, continuing without update info:",
                error
            );
        }

        return response<ListSitesResponse>(res, {
            data: {
                sites: sitesWithUpdates,
                pagination: {
                    total: totalCount,
                    limit,
                    offset
                }
            },
            success: true,
            error: false,
            message: "Sites retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
