import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { resourceRules, resourcePolicyRules, resources } from "@server/db";
import { and, eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import {
    createApiSuccessResponses,
    NullDataSchema
} from "@server/lib/openapi/createApiResponseSchema";

const deleteResourceRuleSchema = z.strictObject({
    ruleId: z.coerce.number().int().positive(),
    resourceId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "delete",
    path: "/resource/{resourceId}/rule/{ruleId}",
    description: "Delete a resource rule.",
    tags: [OpenAPITags.PublicResourceLegacy],
    request: {
        params: deleteResourceRuleSchema
    },
    responses: createApiSuccessResponses(NullDataSchema)
});

registry.registerPath({
    method: "delete",
    path: "/public-resource/{resourceId}/rule/{ruleId}",
    description: "Delete a resource rule.",
    tags: [OpenAPITags.PublicResource, OpenAPITags.Rule],
    request: {
        params: deleteResourceRuleSchema
    },
    responses: createApiSuccessResponses(NullDataSchema)
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
                .where(
                    and(
                        eq(resourcePolicyRules.ruleId, ruleId),
                        eq(
                            resourcePolicyRules.resourcePolicyId,
                            resource.defaultResourcePolicyId!
                        )
                    )
                )
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
            .where(
                and(
                    eq(resourceRules.ruleId, ruleId),
                    eq(resourceRules.resourceId, resourceId)
                )
            )
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
