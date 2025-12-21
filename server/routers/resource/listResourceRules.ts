import { db } from "@server/db";
import { resourceRules, resources } from "@server/db";
import HttpCode from "@server/types/HttpCode";
import response from "@server/lib/response";
import { eq, sql } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";

const listResourceRulesParamsSchema = z.strictObject({
    resourceId: z.string().transform(Number).pipe(z.int().positive())
});

const listResourceRulesSchema = z.object({
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

function queryResourceRules(resourceId: number) {
    const baseQuery = db
        .select({
            ruleId: resourceRules.ruleId,
            resourceId: resourceRules.resourceId,
            action: resourceRules.action,
            match: resourceRules.match,
            value: resourceRules.value,
            priority: resourceRules.priority,
            enabled: resourceRules.enabled,
            method: resourceRules.method
        })
        .from(resourceRules)
        .leftJoin(resources, eq(resourceRules.resourceId, resources.resourceId))
        .where(eq(resourceRules.resourceId, resourceId));

    return baseQuery;
}

export type ListResourceRulesResponse = {
    rules: Awaited<ReturnType<typeof queryResourceRules>>;
    pagination: { total: number; limit: number; offset: number };
};

registry.registerPath({
    method: "get",
    path: "/resource/{resourceId}/rules",
    description: "List rules for a resource.",
    tags: [OpenAPITags.Resource, OpenAPITags.Rule],
    request: {
        params: listResourceRulesParamsSchema,
        query: listResourceRulesSchema
    },
    responses: {}
});

export async function listResourceRules(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = listResourceRulesSchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error)
                )
            );
        }
        const { limit, offset } = parsedQuery.data;

        const parsedParams = listResourceRulesParamsSchema.safeParse(
            req.params
        );
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error)
                )
            );
        }
        const { resourceId } = parsedParams.data;

        // Verify the resource exists
        const [resource] = await db
            .select()
            .from(resources)
            .where(eq(resources.resourceId, resourceId))
            .limit(1);

        if (!resource) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource with ID ${resourceId} not found`
                )
            );
        }

        const baseQuery = queryResourceRules(resourceId);

        const countQuery = db
            .select({ count: sql<number>`cast(count(*) as integer)` })
            .from(resourceRules)
            .where(eq(resourceRules.resourceId, resourceId));

        let rulesList = await baseQuery.limit(limit).offset(offset);
        const totalCountResult = await countQuery;
        const totalCount = totalCountResult[0].count;

        // sort rules list by the priority in ascending order
        rulesList = rulesList.sort((a, b) => a.priority - b.priority);

        return response<ListResourceRulesResponse>(res, {
            data: {
                rules: rulesList,
                pagination: {
                    total: totalCount,
                    limit,
                    offset
                }
            },
            success: true,
            error: false,
            message: "Resource rules retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
