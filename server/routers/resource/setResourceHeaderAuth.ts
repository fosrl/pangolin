import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
    db,
    resourceHeaderAuth,
    resourceHeaderAuthExtendedCompatibility,
    resourcePolicyHeaderAuth,
    resources
} from "@server/db";
import { eq } from "drizzle-orm";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { fromError } from "zod-validation-error";
import { response } from "@server/lib/response";
import logger from "@server/logger";
import { hashPassword } from "@server/auth/password";
import { OpenAPITags, registry } from "@server/openApi";

const setResourceAuthMethodsParamsSchema = z.object({
    resourceId: z.coerce.number().int().positive()
});

const setResourceAuthMethodsBodySchema = z.strictObject({
    user: z.string().min(4).max(100).nullable(),
    password: z.string().min(4).max(100).nullable(),
    extendedCompatibility: z.boolean().nullable()
});

registry.registerPath({
    method: "post",
    path: "/resource/{resourceId}/header-auth",
    description:
        "Set or update the header authentication for a resource. If user and password is not provided, it will remove the header authentication.",
    tags: [OpenAPITags.PublicResource],
    request: {
        params: setResourceAuthMethodsParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: setResourceAuthMethodsBodySchema
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

export async function setResourceHeaderAuth(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = setResourceAuthMethodsParamsSchema.safeParse(
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

        const parsedBody = setResourceAuthMethodsBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { resourceId } = parsedParams.data;
        const { user, password, extendedCompatibility } = parsedBody.data;

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

        const headerAuthHash =
            user && password && extendedCompatibility !== null
                ? await hashPassword(
                      Buffer.from(`${user}:${password}`).toString("base64")
                  )
                : null;

        await db.transaction(async (trx) => {
            if (isInlinePolicy) {
                const policyId = resource.defaultResourcePolicyId!;
                await trx
                    .delete(resourcePolicyHeaderAuth)
                    .where(
                        eq(resourcePolicyHeaderAuth.resourcePolicyId, policyId)
                    );

                if (headerAuthHash !== null && extendedCompatibility !== null) {
                    await trx.insert(resourcePolicyHeaderAuth).values({
                        resourcePolicyId: policyId,
                        headerAuthHash,
                        extendedCompatibility: extendedCompatibility!
                    });
                }
            } else {
                await trx
                    .delete(resourceHeaderAuth)
                    .where(eq(resourceHeaderAuth.resourceId, resourceId));
                await trx
                    .delete(resourceHeaderAuthExtendedCompatibility)
                    .where(
                        eq(
                            resourceHeaderAuthExtendedCompatibility.resourceId,
                            resourceId
                        )
                    );

                if (headerAuthHash !== null && extendedCompatibility !== null) {
                    await Promise.all([
                        trx
                            .insert(resourceHeaderAuth)
                            .values({ resourceId, headerAuthHash }),
                        trx
                            .insert(resourceHeaderAuthExtendedCompatibility)
                            .values({
                                resourceId,
                                extendedCompatibilityIsActivated:
                                    extendedCompatibility
                            })
                    ]);
                }
            }
        });

        return response(res, {
            data: {},
            success: true,
            error: false,
            message: "Header Authentication set successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
