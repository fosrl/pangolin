import {
    db,
    DB_TYPE,
    Label,
    SiteResource,
    siteNetworks,
    siteResourceLabels,
    siteResources,
    sites,
    labels
} from "@server/db";
import response from "@server/lib/response";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";
import HttpCode from "@server/types/HttpCode";
import type { PaginatedResponse } from "@server/types/Pagination";
import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";
import { tierMatrix } from "@server/lib/billing/tierMatrix";

const listAllSiteResourcesByOrgParamsSchema = z.strictObject({
    orgId: z.string()
});

const listAllSiteResourcesByOrgQuerySchema = z.strictObject({
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
        .min(0)
        .optional()
        .catch(1)
        .default(1)
        .openapi({
            type: "integer",
            default: 1,
            description: "Page number to retrieve"
        }),
    query: z.string().optional(),
    mode: z
        .enum(["host", "cidr", "http"])
        .optional()
        .catch(undefined)
        .openapi({
            type: "string",
            enum: ["host", "cidr", "http"],
            description: "Filter site resources by mode"
        }),
    sort_by: z
        .enum(["name"])
        .optional()
        .catch(undefined)
        .openapi({
            type: "string",
            enum: ["name"],
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
    siteId: z.coerce.number<string>().int().positive().optional().openapi({
        type: "integer",
        description:
            "When set, only site resources associated with this site (via network) are returned"
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
            description: "Filter by resource labels"
        })
});

export type ListAllSiteResourcesByOrgResponse = PaginatedResponse<{
    siteResources: (SiteResource & {
        siteOnlines: boolean[];
        siteIds: number[];
        siteNames: string[];
        siteNiceIds: string[];
        siteAddresses: (string | null)[];
        labels?: Array<Pick<Label, "labelId" | "name" | "color">>;
    })[];
}>;

/**
 * Returns an aggregation expression compatible with both SQLite and PostgreSQL.
 * - SQLite:    json_group_array(col)  → returns a JSON array string, parsed after fetch
 * - PostgreSQL: array_agg(col)        → returns a native array
 */
function aggCol<T>(column: any) {
    if (DB_TYPE === "sqlite") {
        // json_group_array will include NULLs for left-joined missing rows;
        // we filter them out in transformSiteResourceRow keeping arrays aligned.
        return sql<T>`json_group_array(${column})`;
    }
    return sql<T>`COALESCE(array_agg(${column}) FILTER (WHERE ${sites.siteId} IS NOT NULL), '{}')`;
}

/**
 * For SQLite the aggregated columns come back as JSON strings; parse them into
 * proper arrays. For PostgreSQL the driver already returns native arrays, so
 * the row is returned unchanged.
 */
function transformSiteResourceRow(row: any) {
    if (DB_TYPE !== "sqlite") {
        return row;
    }
    const siteIdsRaw = JSON.parse(row.siteIds) as (number | null)[];
    const siteNamesRaw = JSON.parse(row.siteNames) as (string | null)[];
    const siteNiceIdsRaw = JSON.parse(row.siteNiceIds) as (string | null)[];
    const siteAddressesRaw = JSON.parse(row.siteAddresses) as (string | null)[];
    const siteOnlinesRaw = JSON.parse(row.siteOnlines) as (0 | 1 | null)[];

    // When a site resource has no associated sites (left join produced no
    // matches), the aggregated arrays will contain a single NULL entry. Strip
    // those out, keeping the parallel arrays aligned by siteId presence.
    const siteIds: number[] = [];
    const siteNames: string[] = [];
    const siteNiceIds: string[] = [];
    const siteAddresses: (string | null)[] = [];
    const siteOnlines: boolean[] = [];
    for (let i = 0; i < siteIdsRaw.length; i++) {
        if (siteIdsRaw[i] == null) continue;
        siteIds.push(siteIdsRaw[i] as number);
        siteNames.push((siteNamesRaw[i] ?? "") as string);
        siteNiceIds.push((siteNiceIdsRaw[i] ?? "") as string);
        siteAddresses.push(siteAddressesRaw[i] ?? null);
        siteOnlines.push(siteOnlinesRaw[i] === 1);
    }

    return {
        ...row,
        siteNames,
        siteNiceIds,
        siteIds,
        siteAddresses,
        siteOnlines
    };
}

function querySiteResourcesBase() {
    return db
        .select({
            siteResourceId: siteResources.siteResourceId,
            orgId: siteResources.orgId,
            niceId: siteResources.niceId,
            name: siteResources.name,
            mode: siteResources.mode,
            ssl: siteResources.ssl,
            scheme: siteResources.scheme,
            proxyPort: siteResources.proxyPort,
            destinationPort: siteResources.destinationPort,
            destination: siteResources.destination,
            enabled: siteResources.enabled,
            alias: siteResources.alias,
            aliasAddress: siteResources.aliasAddress,
            tcpPortRangeString: siteResources.tcpPortRangeString,
            udpPortRangeString: siteResources.udpPortRangeString,
            disableIcmp: siteResources.disableIcmp,
            authDaemonMode: siteResources.authDaemonMode,
            authDaemonPort: siteResources.authDaemonPort,
            pamMode: siteResources.pamMode,
            subdomain: siteResources.subdomain,
            domainId: siteResources.domainId,
            fullDomain: siteResources.fullDomain,
            networkId: siteResources.networkId,
            defaultNetworkId: siteResources.defaultNetworkId,
            siteNames: aggCol<string[]>(sites.name),
            siteNiceIds: aggCol<string[]>(sites.niceId),
            siteIds: aggCol<number[]>(sites.siteId),
            siteAddresses: aggCol<(string | null)[]>(sites.address),
            siteOnlines: aggCol<boolean[]>(sites.online)
        })
        .from(siteResources)
        .leftJoin(
            siteNetworks,
            eq(siteResources.networkId, siteNetworks.networkId)
        )
        .leftJoin(sites, eq(siteNetworks.siteId, sites.siteId))
        .groupBy(siteResources.siteResourceId);
}

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/site-resources",
    description: "List all site resources for an organization.",
    tags: [OpenAPITags.PrivateResource],
    request: {
        params: listAllSiteResourcesByOrgParamsSchema,
        query: listAllSiteResourcesByOrgQuerySchema
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

export async function listAllSiteResourcesByOrg(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = listAllSiteResourcesByOrgParamsSchema.safeParse(
            req.params
        );
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const parsedQuery = listAllSiteResourcesByOrgQuerySchema.safeParse(
            req.query
        );
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error).toString()
                )
            );
        }

        const { orgId } = parsedParams.data;
        const {
            page,
            pageSize,
            query,
            mode,
            sort_by,
            order,
            siteId,
            labels: labelFilter
        } = parsedQuery.data;

        const isLabelFeatureEnabled = await isLicensedOrSubscribed(
            orgId,
            tierMatrix.labels
        );

        const conditions = [and(eq(siteResources.orgId, orgId))];

        if (siteId != null) {
            // Keep inner joins here: filtering by a specific site implies the
            // resource must have at least one matching site.
            const resourcesForSite = db
                .select({ id: siteResources.siteResourceId })
                .from(siteResources)
                .innerJoin(
                    siteNetworks,
                    eq(siteResources.networkId, siteNetworks.networkId)
                )
                .innerJoin(sites, eq(siteNetworks.siteId, sites.siteId))
                .where(
                    and(
                        eq(siteResources.orgId, orgId),
                        eq(sites.orgId, orgId),
                        eq(sites.siteId, siteId)
                    )
                );
            conditions.push(
                inArray(siteResources.siteResourceId, resourcesForSite)
            );
        }

        if (mode) {
            conditions.push(eq(siteResources.mode, mode));
        }

        if (isLabelFeatureEnabled && labelFilter && labelFilter.length > 0) {
            conditions.push(
                inArray(
                    siteResources.siteResourceId,
                    db
                        .select({ id: siteResourceLabels.siteResourceId })
                        .from(siteResourceLabels)
                        .innerJoin(
                            labels,
                            eq(labels.labelId, siteResourceLabels.labelId)
                        )
                        .where(inArray(labels.name, labelFilter))
                )
            );
        }

        if (query) {
            const q = "%" + query.toLowerCase() + "%";
            const queryList = [
                like(sql`LOWER(${siteResources.name})`, q),
                like(sql`LOWER(${siteResources.niceId})`, q),
                like(sql`LOWER(${siteResources.destination})`, q),
                like(sql`LOWER(${siteResources.alias})`, q),
                like(sql`LOWER(${siteResources.aliasAddress})`, q),
                like(sql`LOWER(${sites.name})`, q)
            ];

            if (isLabelFeatureEnabled) {
                queryList.push(
                    inArray(
                        siteResources.siteResourceId,
                        db
                            .select({ id: siteResourceLabels.siteResourceId })
                            .from(siteResourceLabels)
                            .innerJoin(
                                labels,
                                eq(labels.labelId, siteResourceLabels.labelId)
                            )
                            .where(like(sql`LOWER(${labels.name})`, q))
                    )
                );
            }

            conditions.push(or(...queryList));
        }

        const baseQuery = querySiteResourcesBase().where(and(...conditions));

        const countQuery = db.$count(
            querySiteResourcesBase()
                .where(and(...conditions))
                .as("filtered_site_resources")
        );

        const [siteResourcesRaw, totalCount] = await Promise.all([
            baseQuery
                .limit(pageSize)
                .offset(pageSize * (page - 1))
                .orderBy(
                    sort_by
                        ? order === "asc"
                            ? asc(siteResources[sort_by])
                            : desc(siteResources[sort_by])
                        : asc(siteResources.name)
                ),
            countQuery
        ]);

        const siteResourcesList = siteResourcesRaw.map(
            transformSiteResourceRow
        );

        const siteResourceIdList = siteResourcesList.map(
            (r) => r.siteResourceId
        );

        let labelsForSiteResources: Array<{
            labelId: number;
            name: string;
            color: string;
            siteResourceId: number;
        }> = [];

        if (isLabelFeatureEnabled && siteResourceIdList.length > 0) {
            labelsForSiteResources = await db
                .select({
                    labelId: labels.labelId,
                    name: labels.name,
                    color: labels.color,
                    siteResourceId: siteResourceLabels.siteResourceId
                })
                .from(labels)
                .innerJoin(
                    siteResourceLabels,
                    eq(siteResourceLabels.labelId, labels.labelId)
                )
                .where(
                    inArray(
                        siteResourceLabels.siteResourceId,
                        siteResourceIdList
                    )
                )
                .orderBy(asc(siteResourceLabels.siteResourceLabelId));
        }

        return response<ListAllSiteResourcesByOrgResponse>(res, {
            data: {
                siteResources: siteResourcesList.map((r) => ({
                    ...r,
                    labels: labelsForSiteResources.filter(
                        (l) => l.siteResourceId === r.siteResourceId
                    )
                })),
                pagination: {
                    total: totalCount,
                    pageSize,
                    page
                }
            },
            success: true,
            error: false,
            message: "Site resources retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error("Error listing all site resources by org:", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to list site resources"
            )
        );
    }
}
