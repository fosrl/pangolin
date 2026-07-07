import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { resourceRules, resourcePolicyRules, resources } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";

const deleteResourceRuleSchema = z.strictObject({
    ruleId: z.coerce.number().int().positive(),
    resourceId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "delete",
    path: "/resource/{resourceId}/rule/{ruleId}",
    description: "Delete a resource rule.",
    tags: [OpenAPITags.PublicResource, OpenAPITags.Rule],
    request: {
        params: deleteResourceRuleSchema
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

export async function deleteResourceRule(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = deleteResourceRuleSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { ruleId } = parsedParams.data;

        // Look up resource to determine which table to use
        const { resourceId } = parsedParams.data;
        const [resource] = await db
            .select()
            .from(resources)
            .where(eq(resources.resourceId, resourceId))
            .limit(1);

        if (!resource) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Resource not found")
            );
        }

        const isInlinePolicy =
            resource.resourcePolicyId === null &&
            resource.defaultResourcePolicyId !== null;

        if (isInlinePolicy) {
            const [deletedRule] = await db
                .delete(resourcePolicyRules)
                .where(eq(resourcePolicyRules.ruleId, ruleId))
                .returning();

            if (!deletedRule) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `Resource rule with ID ${ruleId} not found`
                    )
                );
            }

            return response(res, {
                data: null,
                success: true,
                error: false,
                message: "Resource rule deleted successfully",
                status: HttpCode.OK
            });
        }

        // Delete the rule and return the deleted record
        const [deletedRule] = await db
            .delete(resourceRules)
            .where(eq(resourceRules.ruleId, ruleId))
            .returning();

        if (!deletedRule) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource rule with ID ${ruleId} not found`
                )
            );
        }

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Resource rule deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
