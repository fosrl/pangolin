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

// Define Zod schema for request parameters validation
const updateResourceRuleParamsSchema = z
    .object({
        ruleId: z.string().transform(Number).pipe(z.number().int().positive()),
        resourceId: z
            .string()
            .transform(Number)
            .pipe(z.number().int().positive())
    })
    .strict();

// Define Zod schema for request body validation
const updateResourceRuleSchema = z
    .object({
        action: z.enum(["ACCEPT", "DROP", "PASS"]).optional(),
        match: z.enum(["CIDR", "IP", "PATH", "COUNTRY"]).optional(),
        value: z.string().min(1).optional(),
        priority: z.number().int(),
        enabled: z.boolean().optional()
    })
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
        message: "At least one field must be provided for update"
    });

registry.registerPath({
    method: "post",
    path: "/resource/{resourceId}/rule/{ruleId}",
    description: "Update a resource rule.",
    tags: [OpenAPITags.Resource, OpenAPITags.Rule],
    request: {
        params: updateResourceRuleParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: updateResourceRuleSchema
                }
            }
        }
    },
    responses: {}
});

export async function updateResourceRule(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        // Validate path parameters
        const parsedParams = updateResourceRuleParamsSchema.safeParse(
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

        // Validate request body
        const parsedBody = updateResourceRuleSchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { ruleId, resourceId } = parsedParams.data;
        const updateData = parsedBody.data;

        // Verify that the resource exists
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

        // Verify that the rule exists and belongs to the specified resource
        const [existingRule] = await db
            .select()
            .from(resourceRules)
            .where(eq(resourceRules.ruleId, ruleId))
            .limit(1);

        if (!existingRule) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource rule with ID ${ruleId} not found`
                )
            );
        }

        if (existingRule.resourceId !== resourceId) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    `Resource rule ${ruleId} does not belong to resource ${resourceId}`
                )
            );
        }

        const match = updateData.match || existingRule.match;
        const { value } = updateData;

        if (value !== undefined) {
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
                        createHttpError(
                            HttpCode.BAD_REQUEST,
                            "Invalid IP provided"
                        )
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

        // Update the rule
        const [updatedRule] = await db
            .update(resourceRules)
            .set(updateData)
            .where(eq(resourceRules.ruleId, ruleId))
            .returning();

        return response(res, {
            data: updatedRule,
            success: true,
            error: false,
            message: "Resource rule updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
