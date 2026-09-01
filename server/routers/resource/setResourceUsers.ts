import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { userResources, userPolicies, resources } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { eq } from "drizzle-orm";
import { OpenAPITags, registry } from "@server/openApi";

const setUserResourcesBodySchema = z.strictObject({
    userIds: z.array(z.string())
});

const setUserResourcesParamsSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "post",
    path: "/resource/{resourceId}/users",
    description:
        "Set users for a resource. This will replace all existing users. When the resource has an inline policy defined (no shared resource policy assigned), users are set on the inline policy instead of directly on the resource.",
    tags: [OpenAPITags.PublicResourceLegacy],
    request: {
        params: setUserResourcesParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: setUserResourcesBodySchema
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
    path: "/public-resource/{resourceId}/users",
    description:
        "Set users for a resource. This will replace all existing users. When the resource has an inline policy defined (no shared resource policy assigned), users are set on the inline policy instead of directly on the resource.",
    tags: [OpenAPITags.PublicResource, OpenAPITags.User],
    request: {
        params: setUserResourcesParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: setUserResourcesBodySchema
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

export async function setResourceUsers(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = setUserResourcesBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { userIds } = parsedBody.data;

        const parsedParams = setUserResourcesParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

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

        await db.transaction(async (trx) => {
            if (isInlinePolicy) {
                const policyId = resource.defaultResourcePolicyId!;
                await trx
                    .delete(userPolicies)
                    .where(eq(userPolicies.resourcePolicyId, policyId));

                await Promise.all(
                    userIds.map((userId) =>
                        trx
                            .insert(userPolicies)
                            .values({ userId, resourcePolicyId: policyId })
                            .returning()
                    )
                );
            } else {
                await trx
                    .delete(userResources)
                    .where(eq(userResources.resourceId, resourceId));

                await Promise.all(
                    userIds.map((userId) =>
                        trx
                            .insert(userResources)
                            .values({ userId, resourceId })
                            .returning()
                    )
                );
            }

            return response(res, {
                data: {},
                success: true,
                error: false,
                message: "Users set for resource successfully",
                status: HttpCode.CREATED
            });
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
