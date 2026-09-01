import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, resources } from "@server/db";
import { roleResources, roles, rolePolicies } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { eq, and } from "drizzle-orm";
import { OpenAPITags, registry } from "@server/openApi";

const removeRoleFromResourceBodySchema = z
    .object({
        roleId: z.number().int().positive()
    })
    .strict();

const removeRoleFromResourceParamsSchema = z
    .object({
        resourceId: z
            .string()
            .transform(Number)
            .pipe(z.number().int().positive())
    })
    .strict();

registry.registerPath({
    method: "post",
    path: "/resource/{resourceId}/roles/remove",
    description: "Remove a single role from a resource.",
    tags: [OpenAPITags.PublicResourceLegacy],
    request: {
        params: removeRoleFromResourceParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: removeRoleFromResourceBodySchema
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
    path: "/public-resource/{resourceId}/roles/remove",
    description: "Remove a single role from a resource.",
    tags: [OpenAPITags.PublicResource, OpenAPITags.Role],
    request: {
        params: removeRoleFromResourceParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: removeRoleFromResourceBodySchema
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

export async function removeRoleFromResource(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = removeRoleFromResourceBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { roleId } = parsedBody.data;

        const parsedParams = removeRoleFromResourceParamsSchema.safeParse(
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

        // get the resource
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

        // Check if the role is an admin role
        const [roleToCheck] = await db
            .select()
            .from(roles)
            .where(
                and(eq(roles.roleId, roleId), eq(roles.orgId, resource.orgId))
            )
            .limit(1);

        if (!roleToCheck) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "Role not found or does not belong to the same organization"
                )
            );
        }

        if (roleToCheck.isAdmin) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Admin role cannot be removed from resources"
                )
            );
        }

        const isInlinePolicy =
            resource.resourcePolicyId === null &&
            resource.defaultResourcePolicyId !== null;

        if (isInlinePolicy) {
            const policyId = resource.defaultResourcePolicyId!;

            const existingEntry = await db
                .select()
                .from(rolePolicies)
                .where(
                    and(
                        eq(rolePolicies.resourcePolicyId, policyId),
                        eq(rolePolicies.roleId, roleId)
                    )
                );

            if (existingEntry.length === 0) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        "Role not found in resource"
                    )
                );
            }

            await db
                .delete(rolePolicies)
                .where(
                    and(
                        eq(rolePolicies.resourcePolicyId, policyId),
                        eq(rolePolicies.roleId, roleId)
                    )
                );
        } else {
            // Check if role exists in resource
            const existingEntry = await db
                .select()
                .from(roleResources)
                .where(
                    and(
                        eq(roleResources.resourceId, resourceId),
                        eq(roleResources.roleId, roleId)
                    )
                );

            if (existingEntry.length === 0) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        "Role not found in resource"
                    )
                );
            }

            await db
                .delete(roleResources)
                .where(
                    and(
                        eq(roleResources.resourceId, resourceId),
                        eq(roleResources.roleId, roleId)
                    )
                );
        }

        return response(res, {
            data: {},
            success: true,
            error: false,
            message: "Role removed from resource successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
