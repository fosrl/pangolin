import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { resourceRules, resources } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import {
    isValidCIDR,
    isValidIP,
    isValidUrlGlobPattern
} from "@server/lib/validators";
import { OpenAPITags, registry } from "@server/openApi";

const conditionSchema = z.strictObject({
    match: z.enum(["CIDR", "IP", "PATH", "COUNTRY", "ASN"]),
    value: z.string().min(1)
});

const createResourceRuleSchema = z
    .strictObject({
        action: z.enum(["ACCEPT", "DROP", "PASS"]),
        // Single-condition fields (backward-compatible)
        match: z.enum(["CIDR", "IP", "PATH", "COUNTRY", "ASN"]).optional(),
        value: z.string().min(1).optional(),
        // Multi-condition AND support
        conditions: z.array(conditionSchema).min(1).optional(),
        priority: z.int(),
        enabled: z.boolean().optional(),
        method: z
            .enum([
                "GET",
                "POST",
                "PUT",
                "DELETE",
                "PATCH",
                "HEAD",
                "OPTIONS",
                "CONNECT",
                "TRACE"
            ])
            .optional()
    })
    .refine(
        (data) => {
            // Require either single match+value or conditions array
            const hasSingle = !!data.match && !!data.value;
            const hasMulti = Array.isArray(data.conditions) && data.conditions.length > 0;
            return hasSingle || hasMulti;
        },
        {
            message: "Provide either match+value or a non-empty conditions array"
        }
    );

const createResourceRuleParamsSchema = z.strictObject({
    resourceId: z.string().transform(Number).pipe(z.int().positive())
});

registry.registerPath({
    method: "put",
    path: "/resource/{resourceId}/rule",
    description: "Create a resource rule.",
    tags: [OpenAPITags.Resource, OpenAPITags.Rule],
    request: {
        params: createResourceRuleParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: createResourceRuleSchema
                }
            }
        }
    },
    responses: {}
});

export async function createResourceRule(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = createResourceRuleSchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { action, match, value, conditions, priority, enabled, method } = parsedBody.data;

        const parsedParams = createResourceRuleParamsSchema.safeParse(
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

        const { resourceId } = parsedParams.data;

        // Verify that the referenced resource exists
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

        if (!resource.http) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Cannot create rule for non-http resource"
                )
            );
        }

        if (match && value) {
            if (match === "CIDR") {
                if (!isValidCIDR(value)) {
                    return next(
                        createHttpError(
                            HttpCode.BAD_REQUEST,
                            "Invalid CIDR provided"
                        )
                    );
                }
            } else if (match === "IP") {
                if (!isValidIP(value)) {
                    return next(
                        createHttpError(HttpCode.BAD_REQUEST, "Invalid IP provided")
                    );
                }
            } else if (match === "PATH") {
                if (!isValidUrlGlobPattern(value)) {
                    return next(
                        createHttpError(
                            HttpCode.BAD_REQUEST,
                            "Invalid URL glob pattern provided"
                        )
                    );
                }
            }
        }

        // Validate multi-conditions if provided
        if (conditions && conditions.length > 0) {
            for (const c of conditions) {
                if (c.match === "CIDR") {
                    if (!isValidCIDR(c.value)) {
                        return next(
                            createHttpError(HttpCode.BAD_REQUEST, "Invalid CIDR provided in conditions")
                        );
                    }
                } else if (c.match === "IP") {
                    if (!isValidIP(c.value)) {
                        return next(
                            createHttpError(HttpCode.BAD_REQUEST, "Invalid IP provided in conditions")
                        );
                    }
                } else if (c.match === "PATH") {
                    if (!isValidUrlGlobPattern(c.value)) {
                        return next(
                            createHttpError(
                                HttpCode.BAD_REQUEST,
                                "Invalid URL glob pattern provided in conditions"
                            )
                        );
                    }
                }
            }
        }

        // Create the new resource rule
        const [newRule] = await db
            .insert(resourceRules)
            .values([
                {
                    resourceId,
                    action,
                    match,
                    value,
                    // Store JSON-encoded conditions when provided
                    conditions:
                        conditions && conditions.length > 0
                            ? JSON.stringify(conditions)
                            : undefined,
                    priority,
                    enabled,
                    method
                }
            ])
            .returning();

        return response(res, {
            data: newRule,
            success: true,
            error: false,
            message: "Resource rule created successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
