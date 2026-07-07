import { db, sites, targetHealthCheck } from "@server/db";
import { targets } from "@server/db";
import HttpCode from "@server/types/HttpCode";
import response from "@server/lib/response";
import { eq, sql } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";

const listTargetsParamsSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive()
});

const listTargetsSchema = z.strictObject({
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

function queryTargets(resourceId: number) {
    const baseQuery = db
        .select({
            targetId: targets.targetId,
            ip: targets.ip,
            mode: targets.mode,
            method: targets.method,
            port: targets.port,
            enabled: targets.enabled,
            resourceId: targets.resourceId,
            siteId: targets.siteId,
            siteType: sites.type,
            siteName: sites.name,
            hcEnabled: targetHealthCheck.hcEnabled,
            hcPath: targetHealthCheck.hcPath,
            hcScheme: targetHealthCheck.hcScheme,
            hcMode: targetHealthCheck.hcMode,
            hcHostname: targetHealthCheck.hcHostname,
            hcPort: targetHealthCheck.hcPort,
            hcInterval: targetHealthCheck.hcInterval,
            hcUnhealthyInterval: targetHealthCheck.hcUnhealthyInterval,
            hcTimeout: targetHealthCheck.hcTimeout,
            hcHeaders: targetHealthCheck.hcHeaders,
            hcFollowRedirects: targetHealthCheck.hcFollowRedirects,
            hcMethod: targetHealthCheck.hcMethod,
            hcStatus: targetHealthCheck.hcStatus,
            hcHealth: targetHealthCheck.hcHealth,
            hcTlsServerName: targetHealthCheck.hcTlsServerName,
            hcHealthyThreshold: targetHealthCheck.hcHealthyThreshold,
            hcUnhealthyThreshold: targetHealthCheck.hcUnhealthyThreshold,
            path: targets.path,
            pathMatchType: targets.pathMatchType,
            rewritePath: targets.rewritePath,
            rewritePathType: targets.rewritePathType,
            priority: targets.priority
        })
        .from(targets)
        .leftJoin(sites, eq(sites.siteId, targets.siteId))
        .leftJoin(
            targetHealthCheck,
            eq(targetHealthCheck.targetId, targets.targetId)
        )
        .where(eq(targets.resourceId, resourceId));

    return baseQuery;
}

type TargetWithParsedHeaders = Omit<
    Awaited<ReturnType<typeof queryTargets>>[0],
    "hcHeaders"
> & {
    hcHeaders: { name: string; value: string }[] | null;
};

export type ListTargetsResponse = {
    targets: TargetWithParsedHeaders[];
    pagination: { total: number; limit: number; offset: number };
};

registry.registerPath({
    method: "get",
    path: "/resource/{resourceId}/targets",
    description: "List targets for a resource.",
    tags: [OpenAPITags.PublicResource, OpenAPITags.Target],
    request: {
        params: listTargetsParamsSchema,
        query: listTargetsSchema
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

export async function listTargets(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = listTargetsSchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error)
                )
            );
        }
        const { limit, offset } = parsedQuery.data;

        const parsedParams = listTargetsParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error)
                )
            );
        }
        const { resourceId } = parsedParams.data;

        const baseQuery = queryTargets(resourceId);

        const countQuery = db
            .select({ count: sql<number>`cast(count(*) as integer)` })
            .from(targets)
            .where(eq(targets.resourceId, resourceId));

        const targetsList = await baseQuery.limit(limit).offset(offset);
        const totalCountResult = await countQuery;
        const totalCount = totalCountResult[0].count;

        // Parse hcHeaders from JSON string back to array for each target
        const parsedTargetsList = targetsList.map((target) => {
            let parsedHcHeaders = null;
            if (target.hcHeaders) {
                try {
                    parsedHcHeaders = JSON.parse(target.hcHeaders);
                } catch (error) {
                    // If parsing fails, keep as string for backward compatibility
                    parsedHcHeaders = target.hcHeaders;
                }
            }
            return {
                ...target,
                hcHeaders: parsedHcHeaders
            };
        });

        return response<ListTargetsResponse>(res, {
            data: {
                targets: parsedTargetsList,
                pagination: {
                    total: totalCount,
                    limit,
                    offset
                }
            },
            success: true,
            error: false,
            message: "Targets retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
