import { db } from "@server/db";
import { resourceRules, resourcePolicyRules, resources } from "@server/db";
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
    resourceId: z.coerce.number().int().positive()
});

const listResourceRulesSchema = z.strictObject({
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
            enabled: resourceRules.enabled
        })
        .from(resourceRules)
        .leftJoin(resources, eq(resourceRules.resourceId, resources.resourceId))
        .where(eq(resourceRules.resourceId, resourceId));

    return baseQuery;
}

function queryPolicyRules(policyId: number) {
    return db
        .select({
            ruleId: resourcePolicyRules.ruleId,
            resourceId: sql<number | null>`null`,
            action: resourcePolicyRules.action,
            match: resourcePolicyRules.match,
            value: resourcePolicyRules.value,
            priority: resourcePolicyRules.priority,
            enabled: resourcePolicyRules.enabled
        })
        .from(resourcePolicyRules)
        .where(eq(resourcePolicyRules.resourcePolicyId, policyId));
}

export type ListResourceRulesResponse = {
    rules: Awaited<ReturnType<typeof queryResourceRules>>;
    pagination: { total: number; limit: number; offset: number };
};

registry.registerPath({
    method: "get",
    path: "/resource/{resourceId}/rules",
    description: "List rules for a resource.",
    tags: [OpenAPITags.PublicResourceLegacy],
    request: {
        params: listResourceRulesParamsSchema,
        query: listResourceRulesSchema
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

registry.registerPath({
    method: "get",
    path: "/public-resource/{resourceId}/rules",
    description: "List rules for a resource.",
    tags: [OpenAPITags.PublicResource, OpenAPITags.Rule],
    request: {
        params: listResourceRulesParamsSchema,
        query: listResourceRulesSchema
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

        const isInlinePolicy =
            resource.resourcePolicyId === null &&
            resource.defaultResourcePolicyId !== null;

        let rulesList: Awaited<ReturnType<typeof queryResourceRules>>;
        let totalCount: number;

        if (isInlinePolicy) {
            const policyId = resource.defaultResourcePolicyId!;
            const policyRules = await queryPolicyRules(policyId)
                .limit(limit)
                .offset(offset);
            const countResult = await db
                .select({ count: sql<number>`cast(count(*) as integer)` })
                .from(resourcePolicyRules)
                .where(eq(resourcePolicyRules.resourcePolicyId, policyId));
            rulesList = policyRules as typeof rulesList;
            totalCount = countResult[0].count;
        } else {
            const baseQuery = queryResourceRules(resourceId);
            const countQuery = db
                .select({ count: sql<number>`cast(count(*) as integer)` })
                .from(resourceRules)
                .where(eq(resourceRules.resourceId, resourceId));
            rulesList = await baseQuery.limit(limit).offset(offset);
            const totalCountResult = await countQuery;
            totalCount = totalCountResult[0].count;
        }

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
