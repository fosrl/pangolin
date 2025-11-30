import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, resourceHeaderAuth } from "@server/db";
import {
    resources,
    userResources,
    roleResources,
    resourcePassword,
    resourcePincode,
    targets,
    targetHealthCheck,
} from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { sql, eq, or, inArray, and, count } from "drizzle-orm";
import logger from "@server/logger";
import stoi from "@server/lib/stoi";
import { fromZodError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { warn } from "console";

const listResourcesParamsSchema = z
    .object({
        orgId: z.string()
    })
    .strict();

const listResourcesSchema = z.object({
    limit: z
        .string()
        .optional()
        .default("1000")
        .transform(Number)
        .pipe(z.number().int().nonnegative()),

    offset: z
        .string()
        .optional()
        .default("0")
        .transform(Number)
        .pipe(z.number().int().nonnegative())
});

// (resource fields + a single joined target)
type JoinedRow = {
    resourceId: number;
    niceId: string;
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
    headerAuthId: number | null;

    targetId: number | null;
    targetIp: string | null;
    targetPort: number | null;
    targetEnabled: boolean | null;

    hcHealth: string | null;
    hcEnabled: boolean | null;
};

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
    targets: Array<{
        targetId: number;
        ip: string;
        port: number;
        enabled: boolean;
        healthStatus?: 'healthy' | 'unhealthy' | 'unknown';
    }>;
};

function queryResources(accessibleResourceIds: number[], orgId: string) {
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

            targetId: targets.targetId,
            targetIp: targets.ip,
            targetPort: targets.port,
            targetEnabled: targets.enabled,

            hcHealth: targetHealthCheck.hcHealth,
            hcEnabled: targetHealthCheck.hcEnabled,
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
        .leftJoin(targets, eq(targets.resourceId, resources.resourceId))
        .leftJoin(
            targetHealthCheck,
            eq(targetHealthCheck.targetId, targets.targetId)
        )
        .where(
            and(
                inArray(resources.resourceId, accessibleResourceIds),
                eq(resources.orgId, orgId)
            )
        );
}

export type ListResourcesResponse = {
    resources: ResourceWithTargets[];
    pagination: { total: number; limit: number; offset: number };
};

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/resources",
    description: "List resources for an organization.",
    tags: [OpenAPITags.Org, OpenAPITags.Resource],
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
        const { limit, offset } = parsedQuery.data;

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

        const countQuery: any = db
            .select({ count: count() })
            .from(resources)
            .where(inArray(resources.resourceId, accessibleResourceIds));

        const baseQuery = queryResources(accessibleResourceIds, orgId);

        const rows: JoinedRow[] = await baseQuery.limit(limit).offset(offset);

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
                    targets: [],
                };
                map.set(row.resourceId, entry);
            }

            if (row.targetId != null && row.targetIp && row.targetPort != null && row.targetEnabled != null) {
                let healthStatus: 'healthy' | 'unhealthy' | 'unknown' = 'unknown';

                if (row.hcEnabled && row.hcHealth) {
                    healthStatus = row.hcHealth as 'healthy' | 'unhealthy' | 'unknown';
                }

                entry.targets.push({
                    targetId: row.targetId,
                    ip: row.targetIp,
                    port: row.targetPort,
                    enabled: row.targetEnabled,
                    healthStatus: healthStatus,
                });
            }
        }

        const resourcesList: ResourceWithTargets[] = Array.from(map.values());

        const totalCountResult = await countQuery;
        const totalCount = totalCountResult[0]?.count ?? 0;

        return response<ListResourcesResponse>(res, {
            data: {
                resources: resourcesList,
                pagination: {
                    total: totalCount,
                    limit,
                    offset
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
