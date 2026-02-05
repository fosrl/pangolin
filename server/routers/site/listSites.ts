import {
    db,
    exitNodes,
    newts,
    orgs,
    remoteExitNodes,
    roleSites,
    siteNetworks,
    siteResources,
    targets,
    sites,
    userSites,
    labels,
    siteLabels,
    browserGatewayTarget,
    type Label
} from "@server/db";
import cache from "#dynamic/lib/cache";
import response from "@server/lib/response";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";
import HttpCode from "@server/types/HttpCode";
import type { PaginatedResponse } from "@server/types/Pagination";
import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import semver from "semver";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";
import { tierMatrix } from "@server/lib/billing/tierMatrix";

// Stale-while-revalidate: keeps the last successfully fetched version so that
// a transient network failure / timeout does not flip every site back to
// newtUpdateAvailable: false.
let staleNewtVersion: string | null = null;

async function getLatestNewtVersion(): Promise<string | null> {
    try {
        const cachedVersion = await cache.get<string>(
            "cache:latestNewtVersion"
        );
        if (cachedVersion) {
            return cachedVersion;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1500);

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
            return staleNewtVersion;
        }

        let tags = await response.json();
        if (!Array.isArray(tags) || tags.length === 0) {
            logger.warn("No tags found for Newt repository");
            return staleNewtVersion;
        }

        // Remove release-candidates, then sort descending by semver so that
        // duplicate tags (e.g. "1.10.3" and "v1.10.3") and any ordering quirks
        // from the GitHub API do not cause an older tag to be selected.
        tags = tags.filter((tag: any) => !tag.name.includes("rc"));
        tags.sort((a: any, b: any) => {
            const va = semver.coerce(a.name);
            const vb = semver.coerce(b.name);
            if (!va && !vb) return 0;
            if (!va) return 1;
            if (!vb) return -1;
            return semver.rcompare(va, vb);
        });

        // Deduplicate: keep only the first (highest) entry per normalised version
        const seen = new Set<string>();
        tags = tags.filter((tag: any) => {
            const normalised = semver.coerce(tag.name)?.version;
            if (!normalised || seen.has(normalised)) return false;
            seen.add(normalised);
            return true;
        });

        if (tags.length === 0) {
            logger.warn("No valid semver tags found for Newt repository");
            return staleNewtVersion;
        }

        const latestVersion = tags[0].name;

        staleNewtVersion = latestVersion;
        await cache.set("cache:latestNewtVersion", latestVersion, 3600);

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
        return staleNewtVersion;
    }
}

const listSitesParamsSchema = z.strictObject({
    orgId: z.string()
});

const listSitesSchema = z.object({
    pageSize: z.coerce
        .number<string>() // for prettier formatting
        .int()
        .positive()
        .optional()
        .catch(20)
        .default(20)
        .openapi({
            type: "integer",
            default: 20,
            description: "Number of items per page"
        }),
    page: z.coerce
        .number<string>() // for prettier formatting
        .int()
        .positive()
        .optional()
        .catch(1)
        .default(1)
        .openapi({
            type: "integer",
            default: 1,
            description: "Page number to retrieve"
        }),
    query: z.string().optional(),
    sort_by: z
        .enum(["name", "megabytesIn", "megabytesOut"])
        .optional()
        .catch(undefined)
        .openapi({
            type: "string",
            enum: ["name", "megabytesIn", "megabytesOut"],
            description: "Field to sort by"
        }),
    order: z
        .enum(["asc", "desc"])
        .optional()
        .default("asc")
        .catch("asc")
        .openapi({
            type: "string",
            enum: ["asc", "desc"],
            default: "asc",
            description: "Sort order"
        }),
    online: z
        .enum(["true", "false"])
        .transform((v) => v === "true")
        .optional()
        .catch(undefined)
        .openapi({
            type: "boolean",
            description: "Filter by online status"
        }),
    status: z
        .enum(["pending", "approved"])
        .optional()
        .catch(undefined)
        .openapi({
            type: "string",
            enum: ["pending", "approved"],
            description: "Filter by site status"
        }),
    labels: z
        .preprocess((val) => {
            if (val === undefined || val === null || val === "") {
                return undefined;
            }
            if (Array.isArray(val)) {
                return val;
            }
            // the array is returned as this
            if (typeof val === "string") {
                return val.split(",");
            }
            return undefined;
        }, z.array(z.string()))
        .optional()
        .catch([])
        .openapi({
            type: "array",
            description: "Filter by site labels"
        })
});

function querySitesBase() {
    return db
        .selectDistinct({
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
            remoteExitNodeId: remoteExitNodes.remoteExitNodeId,
            resourceCount: sql<number>`(
                SELECT COUNT(DISTINCT ${targets.resourceId})
                FROM ${targets}
                WHERE ${targets.siteId} = ${sites.siteId}
            ) + (
                SELECT COUNT(DISTINCT ${siteResources.siteResourceId})
                FROM ${siteResources}
                INNER JOIN ${siteNetworks}
                    ON ${siteResources.networkId} = ${siteNetworks.networkId}
                WHERE ${siteNetworks.siteId} = ${sites.siteId}
                    AND ${siteResources.orgId} = ${sites.orgId}
            ) + (
                SELECT COUNT(DISTINCT ${browserGatewayTarget.resourceId})
                FROM ${browserGatewayTarget}
                WHERE ${browserGatewayTarget.siteId} = ${sites.siteId}
            )`,
            publicIp: sites.publicIp,
            dnsAuthorityEnabled: sites.dnsAuthorityEnabled,
            dnsStatus: sites.dnsStatus,
            status: sites.status
        })
        .from(sites)
        .leftJoin(orgs, eq(sites.orgId, orgs.orgId))
        .leftJoin(newts, eq(newts.siteId, sites.siteId))
        .leftJoin(exitNodes, eq(exitNodes.exitNodeId, sites.exitNodeId))
        .leftJoin(
            remoteExitNodes,
            eq(remoteExitNodes.exitNodeId, sites.exitNodeId)
        );
}

type SiteRowBase = Awaited<ReturnType<typeof querySitesBase>>[0];

type SiteWithUpdateAvailable = Omit<SiteRowBase, "online"> & {
    online?: SiteRowBase["online"]; // undefined for local sites
    newtUpdateAvailable?: boolean;
    labels?: Array<Pick<Label, "color" | "labelId" | "name">>;
};

export type ListSitesResponse = PaginatedResponse<{
    sites: SiteWithUpdateAvailable[];
}>;

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/sites",
    description: "List all sites in an organization",
    tags: [OpenAPITags.Org, OpenAPITags.Site],
    request: {
        params: listSitesParamsSchema,
        query: listSitesSchema
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: z.object({
                        data: z.unknown().nullable(),
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
                        inArray(roleSites.roleId, req.userOrgRoleIds!)
                    )
                );
        } else {
            accessibleSites = await db
                .select({ siteId: sites.siteId })
                .from(sites)
                .where(eq(sites.orgId, orgId));
        }

        const isLabelFeatureEnabled = await isLicensedOrSubscribed(
            orgId,
            tierMatrix.labels
        );

        const {
            pageSize,
            page,
            query,
            sort_by,
            order,
            online,
            status,
            labels: labelFilter
        } = parsedQuery.data;

        const accessibleSiteIds = accessibleSites.map((site) => site.siteId);

        const conditions = [
            and(
                inArray(sites.siteId, accessibleSiteIds),
                eq(sites.orgId, orgId)
            )
        ];

        if (typeof online !== "undefined") {
            conditions.push(eq(sites.online, online));
        }
        if (typeof status !== "undefined") {
            conditions.push(eq(sites.status, status));
        }

        if (isLabelFeatureEnabled && labelFilter && labelFilter.length > 0) {
            conditions.push(
                inArray(
                    sites.siteId,
                    db
                        .select({ id: siteLabels.siteId })
                        .from(siteLabels)
                        .innerJoin(
                            labels,
                            eq(labels.labelId, siteLabels.labelId)
                        )
                        .where(inArray(labels.name, labelFilter))
                )
            );
        }

        if (query) {
            const q = "%" + query.toLowerCase() + "%";
            const queryList = [
                like(sql`LOWER(${sites.name})`, q),
                like(sql`LOWER(${sites.niceId})`, q)
            ];

            if (isLabelFeatureEnabled) {
                queryList.push(
                    inArray(
                        sites.siteId,
                        db
                            .select({ id: siteLabels.siteId })
                            .from(siteLabels)
                            .innerJoin(
                                labels,
                                eq(labels.labelId, siteLabels.labelId)
                            )
                            .where(like(sql`LOWER(${labels.name})`, q))
                    )
                );
            }
            conditions.push(or(...queryList));
        }

        const baseQuery = querySitesBase().where(and(...conditions));

        // we need to add `as` so that drizzle filters the result as a subquery
        const countQuery = db.$count(
            querySitesBase()
                .where(and(...conditions))
                .as("filtered_sites")
        );

        const siteListQuery = baseQuery
            .limit(pageSize)
            .offset(pageSize * (page - 1))
            .orderBy(
                sort_by
                    ? order === "asc"
                        ? asc(sites[sort_by])
                        : desc(sites[sort_by])
                    : asc(sites.name)
            );

        const [totalCount, rows] = await Promise.all([
            countQuery,
            siteListQuery
        ]);

        // Get latest version asynchronously without blocking the response
        const latestNewtVersionPromise = getLatestNewtVersion();

        const siteIds = rows.map((site) => site.siteId);

        let labelsForSites: Array<{
            labelId: number;
            name: string;
            color: string;
            siteId: number;
        }> = [];

        if (isLabelFeatureEnabled) {
            labelsForSites =
                siteIds.length === 0
                    ? []
                    : await db
                          .select({
                              labelId: labels.labelId,
                              name: labels.name,
                              color: labels.color,
                              siteId: siteLabels.siteId
                          })
                          .from(labels)
                          .innerJoin(
                              siteLabels,
                              eq(siteLabels.labelId, labels.labelId)
                          )
                          .where(inArray(siteLabels.siteId, siteIds))
                          .orderBy(asc(siteLabels.siteLabelId));
        }

        const sitesWithUpdates: SiteWithUpdateAvailable[] = rows.map((site) => {
            const siteWithUpdate: SiteWithUpdateAvailable = { ...site };
            // Initially set to false, will be updated if version check succeeds
            siteWithUpdate.newtUpdateAvailable = false;

            // associate labels
            const labelsForSite = labelsForSites.filter(
                (label) => label.siteId === site.siteId
            );

            return { ...siteWithUpdate, labels: labelsForSite };
        });

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

        const sitesPayload = sitesWithUpdates.map((site) =>
            site.type === "local" ? { ...site, online: undefined } : site
        );

        return response<ListSitesResponse>(res, {
            data: {
                sites: sitesPayload,
                pagination: {
                    total: totalCount,
                    pageSize,
                    page
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
