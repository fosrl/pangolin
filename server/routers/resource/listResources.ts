import {
    db,
    resourceGroups,
    resourceHeaderAuth,
    resourceHeaderAuthExtendedCompatibility,
    resourcePassword,
    resourcePincode,
    resources,
    roleResources,
    targetHealthCheck,
    targets,
    userResources
} from "@server/db";
import response from "@server/lib/response";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";
import HttpCode from "@server/types/HttpCode";
import type { PaginatedResponse } from "@server/types/Pagination";
import {
    and,
    asc,
    count,
    desc,
    eq,
    inArray,
    isNull,
    like,
    not,
    or,
    sql,
    type SQL
} from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";

const listResourcesParamsSchema = z.strictObject({
    orgId: z.string()
});

const listResourcesSchema = z.object({
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
    enabled: z
        .enum(["true", "false"])
        .transform((v) => v === "true")
        .optional()
        .catch(undefined)
        .openapi({
            type: "boolean",
            description: "Filter resources based on enabled status"
        }),
    authState: z
        .enum(["protected", "not_protected", "none"])
        .optional()
        .catch(undefined)
        .openapi({
            type: "string",
            enum: ["protected", "not_protected", "none"],
            description:
                "Filter resources based on authentication state. `protected` means the resource has at least one auth mechanism (password, pincode, header auth, SSO, or email whitelist). `not_protected` means the resource has no auth mechanisms. `none` means the resource is not protected by HTTP (i.e. it has no auth mechanisms and http is false)."
        }),
    healthStatus: z
        .enum(["no_targets", "healthy", "degraded", "offline", "unknown"])
        .optional()
        .catch(undefined)
        .openapi({
            type: "string",
            enum: ["no_targets", "healthy", "degraded", "offline", "unknown"],
            description:
                "Filter resources based on health status of their targets. `healthy` means all targets are healthy. `degraded` means at least one target is unhealthy, but not all are unhealthy. `offline` means all targets are unhealthy. `unknown` means all targets have unknown health status. `no_targets` means the resource has no targets."
        })
});

// grouped by resource with targets[])
export type ResourceWithTargets = {
    resourceId: number;
    name: string;
    ssl: boolean;
    fullDomain: string | null;
    passwordId: number | null;
    sso: boolean;
    pincodeId: number | null;
    whitelist: boolean;
    http: boolean;
    protocol: string;
    proxyPort: number | null;
    enabled: boolean;
    domainId: string | null;
    niceId: string;
    headerAuthId: number | null;
    groupId: number | null;
    targets: Array<{
        targetId: number;
        ip: string;
        port: number;
        enabled: boolean;
        healthStatus: "healthy" | "unhealthy" | "unknown" | null;
    }>;
};

// Aggregate filters
const total_targets = count(targets.targetId);
const healthy_targets = sql<number>`SUM(
                    CASE
                    WHEN ${targetHealthCheck.hcHealth} = 'healthy' THEN 1
                    ELSE 0
                    END
                ) `;
const unknown_targets = sql<number>`SUM(
                    CASE
                    WHEN ${targetHealthCheck.hcHealth} = 'unknown' THEN 1
                    ELSE 0
                    END
                ) `;
const unhealthy_targets = sql<number>`SUM(
                    CASE
                    WHEN ${targetHealthCheck.hcHealth} = 'unhealthy' THEN 1
                    ELSE 0
                    END
                ) `;

function queryResourcesBase() {
    return db
        .select({
            resourceId: resources.resourceId,
            name: resources.name,
            ssl: resources.ssl,
            fullDomain: resources.fullDomain,
            passwordId: resourcePassword.passwordId,
            sso: resources.sso,
            pincodeId: resourcePincode.pincodeId,
            whitelist: resources.emailWhitelistEnabled,
            http: resources.http,
            protocol: resources.protocol,
            proxyPort: resources.proxyPort,
            enabled: resources.enabled,
            domainId: resources.domainId,
            niceId: resources.niceId,
            headerAuthId: resourceHeaderAuth.headerAuthId,
            headerAuthExtendedCompatibilityId:
                resourceHeaderAuthExtendedCompatibility.headerAuthExtendedCompatibilityId,
            groupId: resources.groupId
        })
        .from(resources)
        .leftJoin(
            resourcePassword,
            eq(resourcePassword.resourceId, resources.resourceId)
        )
        .leftJoin(
            resourcePincode,
            eq(resourcePincode.resourceId, resources.resourceId)
        )
        .leftJoin(
            resourceHeaderAuth,
            eq(resourceHeaderAuth.resourceId, resources.resourceId)
        )
        .leftJoin(
            resourceHeaderAuthExtendedCompatibility,
            eq(
                resourceHeaderAuthExtendedCompatibility.resourceId,
                resources.resourceId
            )
        )
        .leftJoin(targets, eq(targets.resourceId, resources.resourceId))
        .leftJoin(
            targetHealthCheck,
            eq(targetHealthCheck.targetId, targets.targetId)
        )
        .groupBy(
            resources.resourceId,
            resourcePassword.passwordId,
            resourcePincode.pincodeId,
            resourceHeaderAuth.headerAuthId,
            resourceHeaderAuthExtendedCompatibility.headerAuthExtendedCompatibilityId,
            resources.groupId
        );
}

export type ListResourcesResponse = PaginatedResponse<{
    resources: ResourceWithTargets[];
}>;

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/resources",
    description: "List resources for an organization.",
    tags: [OpenAPITags.PublicResource],
    request: {
        params: z.object({
            orgId: z.string()
        }),
        query: listResourcesSchema
    },
    responses: {}
});

export async function listResources(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = listResourcesSchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsedQuery.error)
                )
            );
        }
        const {
            page,
            pageSize,
            authState,
            enabled,
            query,
            healthStatus,
            sort_by,
            order
        } = parsedQuery.data;

        const parsedParams = listResourcesParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsedParams.error)
                )
            );
        }

        const orgId =
            parsedParams.data.orgId ||
            req.userOrg?.orgId ||
            req.apiKeyOrg?.orgId;

        if (!orgId) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid organization ID")
            );
        }

        if (req.user && orgId && orgId !== req.userOrgId) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not have access to this organization"
                )
            );
        }

        let accessibleResources: Array<{ resourceId: number }>;
        if (req.user) {
            accessibleResources = await db
                .select({
                    resourceId: sql<number>`COALESCE(${userResources.resourceId}, ${roleResources.resourceId})`
                })
                .from(userResources)
                .fullJoin(
                    roleResources,
                    eq(userResources.resourceId, roleResources.resourceId)
                )
                .where(
                    or(
                        eq(userResources.userId, req.user!.userId),
                        eq(roleResources.roleId, req.userOrgRoleId!)
                    )
                );
        } else {
            accessibleResources = await db
                .select({
                    resourceId: resources.resourceId
                })
                .from(resources)
                .where(eq(resources.orgId, orgId));
        }

        const accessibleResourceIds = accessibleResources.map(
            (resource) => resource.resourceId
        );

        const conditions = [
            and(
                inArray(resources.resourceId, accessibleResourceIds),
                eq(resources.orgId, orgId)
            )
        ];

        if (query) {
            conditions.push(
                or(
                    like(
                        sql`LOWER(${resources.name})`,
                        "%" + query.toLowerCase() + "%"
                    ),
                    like(
                        sql`LOWER(${resources.niceId})`,
                        "%" + query.toLowerCase() + "%"
                    ),
                    like(
                        sql`LOWER(${resources.fullDomain})`,
                        "%" + query.toLowerCase() + "%"
                    )
                )
            );
        }
        if (typeof enabled !== "undefined") {
            conditions.push(eq(resources.enabled, enabled));
        }

        if (typeof authState !== "undefined") {
            switch (authState) {
                case "none":
                    conditions.push(eq(resources.http, false));
                    break;
                case "protected":
                    conditions.push(
                        or(
                            eq(resources.sso, true),
                            eq(resources.emailWhitelistEnabled, true),
                            not(isNull(resourceHeaderAuth.headerAuthId)),
                            not(isNull(resourcePincode.pincodeId)),
                            not(isNull(resourcePassword.passwordId))
                        )
                    );
                    break;
                case "not_protected":
                    conditions.push(
                        not(eq(resources.sso, true)),
                        not(eq(resources.emailWhitelistEnabled, true)),
                        isNull(resourceHeaderAuth.headerAuthId),
                        isNull(resourcePincode.pincodeId),
                        isNull(resourcePassword.passwordId)
                    );
                    break;
            }
        }

        let aggregateFilters: SQL<any> | undefined = sql`1 = 1`;

        if (typeof healthStatus !== "undefined") {
            switch (healthStatus) {
                case "healthy":
                    aggregateFilters = and(
                        sql`${total_targets} > 0`,
                        sql`${healthy_targets} = ${total_targets}`
                    );
                    break;
                case "degraded":
                    aggregateFilters = and(
                        sql`${total_targets} > 0`,
                        sql`${unhealthy_targets} > 0`
                    );
                    break;
                case "no_targets":
                    aggregateFilters = sql`${total_targets} = 0`;
                    break;
                case "offline":
                    aggregateFilters = and(
                        sql`${total_targets} > 0`,
                        sql`${healthy_targets} = 0`,
                        sql`${unhealthy_targets} = ${total_targets}`
                    );
                    break;
                case "unknown":
                    aggregateFilters = and(
                        sql`${total_targets} > 0`,
                        sql`${unknown_targets} = ${total_targets}`
                    );
                    break;
            }
        }

        const baseQuery = queryResourcesBase()
            .where(and(...conditions))
            .having(aggregateFilters);

        // we need to add `as` so that drizzle filters the result as a subquery
        const countQuery = db.$count(baseQuery.as("filtered_resources"));

        const [rows, totalCount] = await Promise.all([
            baseQuery
                .limit(pageSize)
                .offset(pageSize * (page - 1))
                .orderBy(
                    sort_by
                        ? order === "asc"
                            ? asc(resources[sort_by])
                            : desc(resources[sort_by])
                        : asc(resources.name)
                ),
            countQuery
        ]);

        const resourceIdList = rows.map((row) => row.resourceId);
        const allResourceTargets =
            resourceIdList.length === 0
                ? []
                : await db
                      .select({
                          targetId: targets.targetId,
                          resourceId: targets.resourceId,
                          ip: targets.ip,
                          port: targets.port,
                          enabled: targets.enabled,
                          healthStatus: targetHealthCheck.hcHealth,
                          hcEnabled: targetHealthCheck.hcEnabled
                      })
                      .from(targets)
                      .where(inArray(targets.resourceId, resourceIdList))
                      .leftJoin(
                          targetHealthCheck,
                          eq(targetHealthCheck.targetId, targets.targetId)
                      );

        // avoids TS issues with reduce/never[]
        const map = new Map<number, ResourceWithTargets>();

        for (const row of rows) {
            let entry = map.get(row.resourceId);
            if (!entry) {
                entry = {
                    resourceId: row.resourceId,
                    niceId: row.niceId,
                    name: row.name,
                    ssl: row.ssl,
                    fullDomain: row.fullDomain,
                    passwordId: row.passwordId,
                    sso: row.sso,
                    pincodeId: row.pincodeId,
                    whitelist: row.whitelist,
                    http: row.http,
                    protocol: row.protocol,
                    proxyPort: row.proxyPort,
                    enabled: row.enabled,
                    domainId: row.domainId,
                    headerAuthId: row.headerAuthId,
                    groupId: row.groupId,
                    targets: []
                };
                map.set(row.resourceId, entry);
            }

            entry.targets = allResourceTargets.filter(
                (t) => t.resourceId === entry.resourceId
            );
        }

        const resourcesList: ResourceWithTargets[] = Array.from(map.values());

        return response<ListResourcesResponse>(res, {
            data: {
                resources: resourcesList,
                pagination: {
                    total: totalCount,
                    pageSize,
                    page
                }
            },
            success: true,
            error: false,
            message: "Resources retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
