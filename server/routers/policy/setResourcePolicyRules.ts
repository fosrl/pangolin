import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, resourcePolicyRules, resourcePolicies } from "@server/db";
import { and, eq, notInArray } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import {
    getResourceRuleValueValidationError,
    RESOURCE_RULE_MATCH_TYPES
} from "@server/lib/validators";
import { OpenAPITags, registry } from "@server/openApi";

const ruleSchema = z.strictObject({
    ruleId: z.int().positive().optional(),
    action: z.enum(["ACCEPT", "DROP", "PASS"]).openapi({
        type: "string",
        enum: ["ACCEPT", "DROP", "PASS"],
        description: "rule action"
    }),
    match: z.enum(RESOURCE_RULE_MATCH_TYPES).openapi({
        type: "string",
        enum: [...RESOURCE_RULE_MATCH_TYPES],
        description: "rule match"
    }),
    value: z.string().min(1),
    priority: z.int().openapi({
        type: "integer",
        description: "Rule priority"
    }),
    enabled: z.boolean().optional()
});

const setResourcePolicyRulesBodySchema = z.strictObject({
    applyRules: z.boolean(),
    rules: z.array(ruleSchema)
});

const setResourcePolicyRulesParamsSchema = z.strictObject({
    resourcePolicyId: z.string().transform(Number).pipe(z.int().positive())
});

registry.registerPath({
    method: "post",
    path: "/resource-policy/{resourcePolicyId}/rules",
    description:
        "Set all rules for a resource policy at once. This will replace all existing rules.",
    tags: [OpenAPITags.PublicResourcePolicyLegacy],
    request: {
        params: setResourcePolicyRulesParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: setResourcePolicyRulesBodySchema
                }
            }
        }
    },
    responses: {}
});

registry.registerPath({
    method: "post",
    path: "/public-resource-policy/{resourcePolicyId}/rules",
    description:
        "Set all rules for a resource policy at once. This will replace all existing rules.",
    tags: [OpenAPITags.PublicResourcePolicy],
    request: {
        params: setResourcePolicyRulesParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: setResourcePolicyRulesBodySchema
                }
            }
        }
    },
    responses: {}
});

registry.registerPath({
    method: "put",
    path: "/resource-policy/{resourcePolicyId}/rules",
    description:
        "Set all rules for a resource policy at once. This will replace all existing rules. Deprecated: use POST instead.",
    deprecated: true,
    tags: [OpenAPITags.PublicResourcePolicyLegacy],
    request: {
        params: setResourcePolicyRulesParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: setResourcePolicyRulesBodySchema
                }
            }
        }
    },
    responses: {}
});

registry.registerPath({
    method: "put",
    path: "/public-resource-policy/{resourcePolicyId}/rules",
    description:
        "Set all rules for a resource policy at once. This will replace all existing rules. Deprecated: use POST instead.",
    deprecated: true,
    tags: [OpenAPITags.PublicResourcePolicy],
    request: {
        params: setResourcePolicyRulesParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: setResourcePolicyRulesBodySchema
                }
            }
        }
    },
    responses: {}
});

export async function setResourcePolicyRules(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = setResourcePolicyRulesParamsSchema.safeParse(
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

        const parsedBody = setResourcePolicyRulesBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { resourcePolicyId } = parsedParams.data;
        const { applyRules, rules } = parsedBody.data;

        const [policy] = await db
            .select()
            .from(resourcePolicies)
            .where(eq(resourcePolicies.resourcePolicyId, resourcePolicyId))
            .limit(1);

        if (!policy) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Resource policy not found")
            );
        }

        for (const rule of rules) {
            const validationError = getResourceRuleValueValidationError(
                rule.match,
                rule.value
            );
            if (validationError) {
                return next(
                    createHttpError(HttpCode.BAD_REQUEST, validationError)
                );
            }
        }

        await db.transaction(async (trx) => {
            await trx
                .update(resourcePolicies)
                .set({ applyRules })
                .where(eq(resourcePolicies.resourcePolicyId, resourcePolicyId));

            const incomingRuleIds = rules
                .map((r) => r.ruleId)
                .filter((id): id is number => id !== undefined);

            // Delete rules that are no longer in the incoming list
            if (incomingRuleIds.length > 0) {
                await trx
                    .delete(resourcePolicyRules)
                    .where(
                        and(
                            eq(
                                resourcePolicyRules.resourcePolicyId,
                                resourcePolicyId
                            ),
                            notInArray(
                                resourcePolicyRules.ruleId,
                                incomingRuleIds
                            )
                        )
                    );
            } else {
                await trx
                    .delete(resourcePolicyRules)
                    .where(
                        eq(
                            resourcePolicyRules.resourcePolicyId,
                            resourcePolicyId
                        )
                    );
            }

            // Update existing rules (those with a ruleId)
            const existingRules = rules.filter(
                (r): r is typeof r & { ruleId: number } =>
                    r.ruleId !== undefined
            );
            for (const rule of existingRules) {
                await trx
                    .update(resourcePolicyRules)
                    .set({
                        action: rule.action,
                        match: rule.match,
                        value: rule.value,
                        priority: rule.priority,
                        enabled: rule.enabled
                    })
                    .where(
                        and(
                            eq(resourcePolicyRules.ruleId, rule.ruleId),
                            eq(
                                resourcePolicyRules.resourcePolicyId,
                                resourcePolicyId
                            )
                        )
                    );
            }

            // Insert new rules (those without a ruleId)
            const newRules = rules.filter((r) => r.ruleId === undefined);
            if (newRules.length > 0) {
                await trx.insert(resourcePolicyRules).values(
                    newRules.map((rule) => ({
                        resourcePolicyId,
                        action: rule.action,
                        match: rule.match,
                        value: rule.value,
                        priority: rule.priority,
                        enabled: rule.enabled
                    }))
                );
            }
        });

        return response(res, {
            data: {},
            success: true,
            error: false,
            message: "Resource policy rules set successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
