import {
    db,
    exitNodes,
    labels,
    newts,
    orgs,
    remoteExitNodes,
    roleSites,
    siteLabels,
    siteNetworks,
    siteResources,
    sites,
    targets,
    userSites,
    type Label
} from "@server/db";
import { regionalCache as cache } from "#dynamic/lib/cache";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import response from "@server/lib/response";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";
import { PaginationSchema } from "@server/lib/openapi/pagination";
import { createApiSuccessResponses } from "@server/lib/openapi/createApiResponseSchema";
import HttpCode from "@server/types/HttpCode";
import type { PaginatedResponse } from "@server/types/Pagination";
import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";
import { createSelectSchema } from "drizzle-zod";

const listSitesParamsSchema = z.strictObject({
    orgId: z.string()
});

const listSitesSchema = z.strictObject({
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
            subnet: sites.exitNodeSubnet,
            megabytesIn: sites.megabytesIn,
            megabytesOut: sites.megabytesOut,
            orgName: orgs.name,
            type: sites.type,
            online: sites.online,
            address: sites.address,
            newtVersion: newts.version,
            agent: newts.agent,
            agentVersion: newts.agentVersion,
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
            )`,
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

export type ListSitesResponse = z.infer<typeof ListSitesResponseDataSchema>;

const SiteListItemSchema = createSelectSchema(sites, {
    siteId: (s) => s.openapi({ description: "Numeric ID of the site." }),
    niceId: (s) =>
        s.openapi({
            description:
                "Human readable ID of the site, unique within the organization."
        }),
    name: (s) => s.openapi({ description: "Site name." }),
    pubKey: (s) =>
        s.openapi({ description: "Legacy WireGuard public key of the site." }),
    megabytesIn: (s) =>
        s.openapi({ description: "Megabytes received from the site." }),
    megabytesOut: (s) =>
        s.openapi({ description: "Megabytes sent to the site." }),
    type: (s) =>
        s.openapi({
            description:
                "Kind of site connector: newt (a Newt tunnel agent), wireguard, or local."
        }),
    address: (s) =>
        s.openapi({
            description:
                "Address assigned to the site inside the overlay network."
        }),
    exitNodeId: (s) =>
        s.openapi({
            description: "ID of the exit node the site connects through."
        }),
    status: z.enum(["approved", "pending"]).nullable().openapi({
        description:
            "Approval state. Sites provisioned with approval required stay pending until approved."
    })
})
    .pick({
        siteId: true,
        niceId: true,
        name: true,
        pubKey: true,
        megabytesIn: true,
        megabytesOut: true,
        type: true,
        address: true,
        exitNodeId: true,
        status: true
    })
    .extend({
        subnet: z.string().nullable().openapi({
            description: "Subnet the exit node allocated to this site."
        }),
        orgName: z.string().nullable().openapi({
            description: "Name of the organization the site belongs to."
        }),
        online: z.boolean().optional().openapi({
            description:
                "Whether the site is currently connected. Not set for local sites."
        }),
        newtVersion: z.string().nullable().openapi({
            description: "Version of the Newt agent."
        }),
        agent: z.string().nullable().openapi({
            description: "Name of the agent software."
        }),
        agentVersion: z.string().nullable().openapi({
            description: "Version of the agent software."
        }),
        exitNodeName: z.string().nullable().openapi({
            description: "Name of the exit node the site connects through."
        }),
        exitNodeEndpoint: z.string().nullable().openapi({
            description: "Endpoint of the exit node the site connects through."
        }),
        remoteExitNodeId: z.string().nullable().openapi({
            description:
                "ID of the remote exit node, when the site connects through one."
        }),
        resourceCount: z.number().int().openapi({
            description:
                "Number of public and private resources served by the site."
        }),
        newtUpdateAvailable: z.boolean().optional().openapi({
            description: "Whether a newer Newt version is available."
        }),
        labels: z
            .array(
                z.object({
                    labelId: z.number().int().openapi({
                        description: "Numeric ID of the label."
                    }),
                    name: z.string().openapi({ description: "Label name." }),
                    color: z.string().openapi({ description: "Label color." })
                })
            )
            .optional()
            .openapi({ description: "Labels attached to the site." })
    });

const ListSitesResponseDataSchema = z.object({
    sites: z.array(SiteListItemSchema),
    pagination: PaginationSchema
});

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/sites",
    description: "List all sites in an organization",
    tags: [OpenAPITags.Site],
    request: {
        params: listSitesParamsSchema,
        query: listSitesSchema
    },
    responses: createApiSuccessResponses(ListSitesResponseDataSchema)
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

        const conditions = [eq(sites.orgId, orgId)];

        if (req.user) {
            const userAccessConditions = [
                inArray(
                    sites.siteId,
                    db
                        .select({ siteId: userSites.siteId })
                        .from(userSites)
                        .where(eq(userSites.userId, req.user.userId))
                )
            ];

            const roleIds = req.userOrgRoleIds ?? [];
            if (roleIds.length > 0) {
                userAccessConditions.push(
                    inArray(
                        sites.siteId,
                        db
                            .select({ siteId: roleSites.siteId })
                            .from(roleSites)
                            .where(inArray(roleSites.roleId, roleIds))
                    )
                );
            }

            conditions.push(
                userAccessConditions.length === 1
                    ? userAccessConditions[0]
                    : or(...userAccessConditions)!
            );
        }

        if (typeof online !== "undefined") {
            conditions.push(eq(sites.online, online));
        }
        if (typeof status !== "undefined") {
            conditions.push(eq(sites.status, status));
        }

        if (labelFilter && labelFilter.length > 0) {
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
                like(sql`LOWER(${sites.niceId})`, q),
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
            ];

            conditions.push(or(...queryList)!);
        }

        const baseQuery = querySitesBase().where(and(...conditions));

        const countQuery = db
            .select({ count: sql<number>`count(*)` })
            .from(sites)
            .where(and(...conditions));

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

        const [countRows, rows] = await Promise.all([
            countQuery,
            siteListQuery
        ]);

        const totalCount = Number(countRows[0]?.count ?? 0);

        const siteIds = rows.map((site) => site.siteId);

        let labelsForSites: Array<{
            labelId: number;
            name: string;
            color: string;
            siteId: number;
        }> = [];

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
