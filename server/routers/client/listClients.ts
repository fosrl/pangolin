import {
    clientLabels,
    clients,
    clientSitesAssociationsCache,
    currentFingerprint,
    db,
    labels,
    olms,
    orgs,
    roleClients,
    sites,
    userClients,
    users,
    type Label
} from "@server/db";
import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import response from "@server/lib/response";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";
import HttpCode from "@server/types/HttpCode";
import type { PaginatedResponse } from "@server/types/Pagination";
import {
    and,
    asc,
    desc,
    eq,
    inArray,
    isNull,
    like,
    or,
    sql,
    type SQL
} from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";

const listClientsParamsSchema = z.strictObject({
    orgId: z.string()
});

const listClientsSchema = z.strictObject({
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
    status: z.preprocess(
        (val: string | undefined) => {
            if (val) {
                return val.split(","); // the search query array is an array joined by commas
            }
            return undefined;
        },
        z
            .array(z.enum(["active", "blocked", "archived"]))
            .optional()
            .default(["active"])
            .catch(["active"])
            .openapi({
                type: "array",
                items: {
                    type: "string",
                    enum: ["active", "blocked", "archived"]
                },
                default: ["active"],
                description:
                    "Filter by client status. Can be a comma-separated list of values. Defaults to 'active'."
            })
    ),
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
            description: "Filter by client labels"
        })
});

function queryClientsBase() {
    return db
        .select({
            clientId: clients.clientId,
            orgId: clients.orgId,
            name: clients.name,
            pubKey: clients.pubKey,
            subnet: clients.subnet,
            megabytesIn: clients.megabytesIn,
            megabytesOut: clients.megabytesOut,
            orgName: orgs.name,
            type: clients.type,
            online: clients.online,
            olmVersion: olms.version,
            userId: clients.userId,
            username: users.username,
            userEmail: users.email,
            niceId: clients.niceId,
            agent: olms.agent,
            approvalState: clients.approvalState,
            olmArchived: olms.archived,
            archived: clients.archived,
            blocked: clients.blocked
        })
        .from(clients)
        .leftJoin(orgs, eq(clients.orgId, orgs.orgId))
        .leftJoin(olms, eq(clients.clientId, olms.clientId))
        .leftJoin(users, eq(clients.userId, users.userId))
        .leftJoin(currentFingerprint, eq(olms.olmId, currentFingerprint.olmId));
}

async function getSiteAssociations(clientIds: number[]) {
    if (clientIds.length === 0) return [];

    return db
        .select({
            clientId: clientSitesAssociationsCache.clientId,
            siteId: clientSitesAssociationsCache.siteId,
            siteName: sites.name,
            siteNiceId: sites.niceId
        })
        .from(clientSitesAssociationsCache)
        .leftJoin(sites, eq(clientSitesAssociationsCache.siteId, sites.siteId))
        .where(inArray(clientSitesAssociationsCache.clientId, clientIds));
}

type ClientWithSites = Awaited<ReturnType<typeof queryClientsBase>>[0] & {
    sites: Array<{
        siteId: number;
        siteName: string | null;
        siteNiceId: string | null;
    }>;
    olmUpdateAvailable?: boolean;
    labels?: Array<Pick<Label, "labelId" | "name" | "color">>;
};

type OlmWithUpdateAvailable = ClientWithSites;

export type ListClientsResponse = PaginatedResponse<{
    clients: Array<ClientWithSites>;
}>;

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/clients",
    description: "List all clients for an organization.",
    tags: [OpenAPITags.Client],
    request: {
        query: listClientsSchema,
        params: listClientsParamsSchema
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

export async function listClients(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = listClientsSchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error)
                )
            );
        }
        const {
            page,
            pageSize,
            online,
            query,
            status,
            sort_by,
            order,
            labels: labelFilter
        } = parsedQuery.data;

        const parsedParams = listClientsParamsSchema.safeParse(req.params);
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

        let accessibleClients;
        if (req.user) {
            accessibleClients = await db
                .select({
                    clientId: sql<number>`COALESCE(${userClients.clientId}, ${roleClients.clientId})`
                })
                .from(userClients)
                .fullJoin(
                    roleClients,
                    eq(userClients.clientId, roleClients.clientId)
                )
                .where(
                    or(
                        eq(userClients.userId, req.user!.userId),
                        inArray(roleClients.roleId, req.userOrgRoleIds!)
                    )
                );
        } else {
            accessibleClients = await db
                .select({ clientId: clients.clientId })
                .from(clients)
                .where(eq(clients.orgId, orgId));
        }

        const accessibleClientIds = accessibleClients.map(
            (client) => client.clientId
        );

        // Get client count with filter
        const conditions = [
            and(
                inArray(clients.clientId, accessibleClientIds),
                eq(clients.orgId, orgId),
                isNull(clients.userId)
            )
        ];

        if (typeof online !== "undefined") {
            conditions.push(eq(clients.online, online));
        }

        if (status.length > 0) {
            const filterAggregates: (SQL<unknown> | undefined)[] = [];

            if (status.includes("active")) {
                filterAggregates.push(
                    and(eq(clients.archived, false), eq(clients.blocked, false))
                );
            }

            if (status.includes("archived")) {
                filterAggregates.push(eq(clients.archived, true));
            }
            if (status.includes("blocked")) {
                filterAggregates.push(eq(clients.blocked, true));
            }

            conditions.push(or(...filterAggregates));
        }

        if (labelFilter && labelFilter.length > 0) {
            conditions.push(
                inArray(
                    clients.clientId,
                    db
                        .select({ id: clientLabels.clientId })
                        .from(clientLabels)
                        .innerJoin(
                            labels,
                            eq(labels.labelId, clientLabels.labelId)
                        )
                        .where(inArray(labels.name, labelFilter))
                )
            );
        }

        if (query) {
            const q = "%" + query.toLowerCase() + "%";
            const queryList = [
                like(sql`LOWER(${clients.name})`, q),
                like(sql`LOWER(${clients.niceId})`, q),
                inArray(
                    clients.clientId,
                    db
                        .select({ id: clientLabels.clientId })
                        .from(clientLabels)
                        .innerJoin(
                            labels,
                            eq(labels.labelId, clientLabels.labelId)
                        )
                        .where(like(sql`LOWER(${labels.name})`, q))
                )
            ];

            conditions.push(or(...queryList));
        }

        const baseQuery = queryClientsBase().where(and(...conditions));

        const countQuery = db.$count(baseQuery.as("filtered_clients"));

        const listMachinesQuery = baseQuery
            .limit(pageSize)
            .offset(pageSize * (page - 1))
            .orderBy(
                sort_by
                    ? order === "asc"
                        ? asc(clients[sort_by])
                        : desc(clients[sort_by])
                    : asc(clients.name)
            );

        const [clientsList, totalCount] = await Promise.all([
            listMachinesQuery,
            countQuery
        ]);

        // Get associated sites for all clients
        const clientIds = clientsList.map((client) => client.clientId);
        const siteAssociations = await getSiteAssociations(clientIds);

        let labelsForClients: Array<{
            labelId: number;
            name: string;
            color: string;
            clientId: number;
        }> = [];

        if (clientIds.length > 0) {
            labelsForClients = await db
                .select({
                    labelId: labels.labelId,
                    name: labels.name,
                    color: labels.color,
                    clientId: clientLabels.clientId
                })
                .from(labels)
                .innerJoin(
                    clientLabels,
                    eq(clientLabels.labelId, labels.labelId)
                )
                .where(inArray(clientLabels.clientId, clientIds))
                .orderBy(asc(clientLabels.clientLabelId));
        }

        // Group site associations by client ID
        const sitesByClient = siteAssociations.reduce(
            (acc, association) => {
                if (!acc[association.clientId]) {
                    acc[association.clientId] = [];
                }
                acc[association.clientId].push({
                    siteId: association.siteId,
                    siteName: association.siteName,
                    siteNiceId: association.siteNiceId
                });
                return acc;
            },
            {} as Record<
                number,
                Array<{
                    siteId: number;
                    siteName: string | null;
                    siteNiceId: string | null;
                }>
            >
        );

        // Merge clients with their site associations and replace name with device name
        const clientsWithSites = clientsList.map((client) => {
            return {
                ...client,
                sites: sitesByClient[client.clientId] || [],
                labels: labelsForClients.filter(
                    (l) => l.clientId === client.clientId
                )
            };
        });

        // REMOVING THIS BECAUSE WE HAVE DIFFERENT TYPES OF CLIENTS NOW
        // const latestOlmVersionPromise = getLatestOlmVersion();

        // const olmsWithUpdates: OlmWithUpdateAvailable[] = clientsWithSites.map(
        //     (client) => {
        //         const OlmWithUpdate: OlmWithUpdateAvailable = { ...client };
        //         // Initially set to false, will be updated if version check succeeds
        //         OlmWithUpdate.olmUpdateAvailable = false;
        //         return OlmWithUpdate;
        //     }
        // );

        // Try to get the latest version, but don't block if it fails
        // try {
        //     const latestOlmVersion = await latestOlVersionPromise;

        //     if (latestOlVersion) {
        //         olmsWithUpdates.forEach((client) => {
        //             try {
        //                 client.olmUpdateAvailable = semver.lt(
        //                     client.olmVersion ? client.olmVersion : "",
        //                     latestOlVersion
        //                 );
        //             } catch (error) {
        //                 client.olmUpdateAvailable = false;
        //             }
        //         });
        //     }
        // } catch (error) {
        //     // Log the error but don't let it block the response
        //     logger.warn(
        //         "Failed to check for OLM updates, continuing without update info:",
        //         error
        //     );
        // }

        return response<ListClientsResponse>(res, {
            data: {
                clients: clientsWithSites,
                pagination: {
                    total: totalCount,
                    page,
                    pageSize
                }
            },
            success: true,
            error: false,
            message: "Clients retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
