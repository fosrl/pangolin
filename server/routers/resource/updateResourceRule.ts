import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { resourcePolicyRules, resourceRules, resources } from "@server/db";
import { and, eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import {
    RESOURCE_RULE_MATCH_TYPES,
    getResourceRuleValueValidationError,
    ResourceRuleMatchType
} from "@server/lib/validators";
import { OpenAPITags, registry } from "@server/openApi";

// Define Zod schema for request parameters validation
const updateResourceRuleParamsSchema = z.strictObject({
    ruleId: z.coerce.number().int().positive(),
    resourceId: z.coerce.number().int().positive()
});

const resourceRuleMatchSchema = z.enum(RESOURCE_RULE_MATCH_TYPES);

// Define Zod schema for request body validation
const updateResourceRuleSchema = z
    .strictObject({
        action: z.enum(["ACCEPT", "DROP", "PASS"]).optional(),
        match: resourceRuleMatchSchema.optional(),
        value: z.string().min(1).optional(),
        priority: z.int(),
        enabled: z.boolean().optional()
    })
    .refine((data) => Object.keys(data).length > 0, {
        error: "At least one field must be provided for update"
    });

registry.registerPath({
    method: "post",
    path: "/resource/{resourceId}/rule/{ruleId}",
    description: "Update a resource rule.",
    tags: [OpenAPITags.PublicResourceLegacy],
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
    method: "post",
    path: "/public-resource/{resourceId}/rule/{ruleId}",
    description: "Update a resource rule.",
    tags: [OpenAPITags.PublicResource, OpenAPITags.Rule],
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

        if (!["http", "ssh", "rdp", "vnc"].includes(resource.mode)) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Cannot update rule for non-http resource"
                )
            );
        }

        const isInlinePolicy =
            resource.resourcePolicyId === null &&
            resource.defaultResourcePolicyId !== null;

        let existingMatch: ResourceRuleMatchType;

        if (isInlinePolicy) {
            const policyId = resource.defaultResourcePolicyId!;
            const [existingRule] = await db
                .select()
                .from(resourcePolicyRules)
                .where(eq(resourcePolicyRules.ruleId, ruleId))
                .limit(1);

            if (!existingRule) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `Resource rule with ID ${ruleId} not found`
                    )
                );
            }

            if (existingRule.resourcePolicyId !== policyId) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        `Resource rule ${ruleId} does not belong to resource ${resourceId}`
                    )
                );
            }

            const parsedExistingMatch = resourceRuleMatchSchema.safeParse(
                existingRule.match
            );
            if (!parsedExistingMatch.success) {
                return next(
                    createHttpError(
                        HttpCode.INTERNAL_SERVER_ERROR,
                        "Resource rule has invalid match type"
                    )
                );
            }
            existingMatch = parsedExistingMatch.data;
        } else {
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

            const parsedExistingMatch = resourceRuleMatchSchema.safeParse(
                existingRule.match
            );
            if (!parsedExistingMatch.success) {
                return next(
                    createHttpError(
                        HttpCode.INTERNAL_SERVER_ERROR,
                        "Resource rule has invalid match type"
                    )
                );
            }
            existingMatch = parsedExistingMatch.data;
        }

        const match = updateData.match || existingMatch;
        const { value } = updateData;

        if (value !== undefined) {
            const valueValidationError = getResourceRuleValueValidationError(
                match,
                value
            );
            if (valueValidationError) {
                return next(
                    createHttpError(HttpCode.BAD_REQUEST, valueValidationError)
                );
            }
        }

        // Update the rule
        const [updatedRule] = isInlinePolicy
            ? await db
                  .update(resourcePolicyRules)
                  .set(updateData)
                  .where(
                      and(
                          eq(resourcePolicyRules.ruleId, ruleId),
                          eq(
                              resourcePolicyRules.resourcePolicyId,
                              resource.defaultResourcePolicyId!
                          )
                      )
                  )
                  .returning()
            : await db
                  .update(resourceRules)
                  .set(updateData)
                  .where(
                      and(
                          eq(resourceRules.ruleId, ruleId),
                          eq(resourceRules.resourceId, resourceId)
                      )
                  )
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
