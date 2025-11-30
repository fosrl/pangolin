import { db, requestAuditLog, resources } from "@server/db";
import { registry } from "@server/openApi";
import { NextFunction } from "express";
import { Request, Response } from "express";
import { eq, gt, lt, and, count, desc } from "drizzle-orm";
import { OpenAPITags } from "@server/openApi";
import { z } from "zod";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { fromError } from "zod-validation-error";
import { QueryRequestAuditLogResponse } from "@server/routers/auditLogs/types";
import response from "@server/lib/response";
import logger from "@server/logger";

export const queryAccessAuditLogsQuery = z.object({
    // iso string just validate its a parseable date
    timeStart: z
        .string()
        .refine((val) => !isNaN(Date.parse(val)), {
            message: "timeStart must be a valid ISO date string"
        })
        .transform((val) => Math.floor(new Date(val).getTime() / 1000)),
    timeEnd: z
        .string()
        .refine((val) => !isNaN(Date.parse(val)), {
            message: "timeEnd must be a valid ISO date string"
        })
        .transform((val) => Math.floor(new Date(val).getTime() / 1000))
        .optional()
        .default(new Date().toISOString()),
    action: z
        .union([z.boolean(), z.string()])
        .transform((val) => (typeof val === "string" ? val === "true" : val))
        .optional(),
    method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).optional(),
    reason: z
        .string()
        .optional()
        .transform(Number)
        .pipe(z.number().int().positive())
        .optional(),
    resourceId: z
        .string()
        .optional()
        .transform(Number)
        .pipe(z.number().int().positive())
        .optional(),
    actor: z.string().optional(),
    location: z.string().optional(),
    host: z.string().optional(),
    path: z.string().optional(),
    limit: z
        .string()
        .optional()
        .default("1000")
        .transform(Number)
        .pipe(z.number().int().positive()),
    offset: z
        .string()
        .optional()
        .default("0")
        .transform(Number)
        .pipe(z.number().int().nonnegative())
});

export const queryRequestAuditLogsParams = z.object({
    orgId: z.string()
});

export const queryRequestAuditLogsCombined =
    queryAccessAuditLogsQuery.merge(queryRequestAuditLogsParams);
type Q = z.infer<typeof queryRequestAuditLogsCombined>;

function getWhere(data: Q) {
    return and(
        gt(requestAuditLog.timestamp, data.timeStart),
        lt(requestAuditLog.timestamp, data.timeEnd),
        eq(requestAuditLog.orgId, data.orgId),
        data.resourceId
            ? eq(requestAuditLog.resourceId, data.resourceId)
            : undefined,
        data.actor ? eq(requestAuditLog.actor, data.actor) : undefined,
        data.method ? eq(requestAuditLog.method, data.method) : undefined,
        data.reason ? eq(requestAuditLog.reason, data.reason) : undefined,
        data.host ? eq(requestAuditLog.host, data.host) : undefined,
        data.location ? eq(requestAuditLog.location, data.location) : undefined,
        data.path ? eq(requestAuditLog.path, data.path) : undefined,
        data.action !== undefined
            ? eq(requestAuditLog.action, data.action)
            : undefined
    );
}

export function queryRequest(data: Q) {
    return db
        .select({
            id: requestAuditLog.id,
            timestamp: requestAuditLog.timestamp,
            orgId: requestAuditLog.orgId,
            action: requestAuditLog.action,
            reason: requestAuditLog.reason,
            actorType: requestAuditLog.actorType,
            actor: requestAuditLog.actor,
            actorId: requestAuditLog.actorId,
            resourceId: requestAuditLog.resourceId,
            ip: requestAuditLog.ip,
            location: requestAuditLog.location,
            userAgent: requestAuditLog.userAgent,
            metadata: requestAuditLog.metadata,
            headers: requestAuditLog.headers,
            query: requestAuditLog.query,
            originalRequestURL: requestAuditLog.originalRequestURL,
            scheme: requestAuditLog.scheme,
            host: requestAuditLog.host,
            path: requestAuditLog.path,
            method: requestAuditLog.method,
            tls: requestAuditLog.tls,
            resourceName: resources.name,
            resourceNiceId: resources.niceId
        })
        .from(requestAuditLog)
        .leftJoin(
            resources,
            eq(requestAuditLog.resourceId, resources.resourceId)
        ) // TODO: Is this efficient?
        .where(getWhere(data))
        .orderBy(desc(requestAuditLog.timestamp), desc(requestAuditLog.id));
}

export function countRequestQuery(data: Q) {
    const countQuery = db
        .select({ count: count() })
        .from(requestAuditLog)
        .where(getWhere(data));
    return countQuery;
}

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/logs/request",
    description: "Query the request audit log for an organization",
    tags: [OpenAPITags.Org],
    request: {
        query: queryAccessAuditLogsQuery,
        params: queryRequestAuditLogsParams
    },
    responses: {}
});

async function queryUniqueFilterAttributes(
    timeStart: number,
    timeEnd: number,
    orgId: string
) {
    const baseConditions = and(
        gt(requestAuditLog.timestamp, timeStart),
        lt(requestAuditLog.timestamp, timeEnd),
        eq(requestAuditLog.orgId, orgId)
    );

    // Get unique actors
    const uniqueActors = await db
        .selectDistinct({
            actor: requestAuditLog.actor
        })
        .from(requestAuditLog)
        .where(baseConditions);

    // Get unique locations
    const uniqueLocations = await db
        .selectDistinct({
            locations: requestAuditLog.location
        })
        .from(requestAuditLog)
        .where(baseConditions);

    // Get unique actors
    const uniqueHosts = await db
        .selectDistinct({
            hosts: requestAuditLog.host
        })
        .from(requestAuditLog)
        .where(baseConditions);

    // Get unique actors
    const uniquePaths = await db
        .selectDistinct({
            paths: requestAuditLog.path
        })
        .from(requestAuditLog)
        .where(baseConditions);

    // Get unique resources with names
    const uniqueResources = await db
        .selectDistinct({
            id: requestAuditLog.resourceId,
            name: resources.name
        })
        .from(requestAuditLog)
        .leftJoin(
            resources,
            eq(requestAuditLog.resourceId, resources.resourceId)
        )
        .where(baseConditions);

    return {
        actors: uniqueActors.map(row => row.actor).filter((actor): actor is string => actor !== null),
        resources: uniqueResources.filter((row): row is { id: number; name: string | null } => row.id !== null),
        locations: uniqueLocations.map(row => row.locations).filter((location): location is string => location !== null),
        hosts: uniqueHosts.map(row => row.hosts).filter((host): host is string => host !== null),
        paths: uniquePaths.map(row => row.paths).filter((path): path is string => path !== null)
    };
}

export async function queryRequestAuditLogs(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = queryAccessAuditLogsQuery.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error)
                )
            );
        }

        const parsedParams = queryRequestAuditLogsParams.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error)
                )
            );
        }

        const data = { ...parsedQuery.data, ...parsedParams.data };

        const baseQuery = queryRequest(data);

        const log = await baseQuery.limit(data.limit).offset(data.offset);

        const totalCountResult = await countRequestQuery(data);
        const totalCount = totalCountResult[0].count;

        const filterAttributes = await queryUniqueFilterAttributes(
            data.timeStart,
            data.timeEnd,
            data.orgId
        );

        return response<QueryRequestAuditLogResponse>(res, {
            data: {
                log: log,
                pagination: {
                    total: totalCount,
                    limit: data.limit,
                    offset: data.offset
                },
                filterAttributes
            },
            success: true,
            error: false,
            message: "Action audit logs retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
