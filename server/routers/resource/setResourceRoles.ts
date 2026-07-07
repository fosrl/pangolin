import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, resources } from "@server/db";
import { apiKeys, roleResources, roles, rolePolicies } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { eq, and, ne, inArray } from "drizzle-orm";
import { OpenAPITags, registry } from "@server/openApi";

const setResourceRolesBodySchema = z.strictObject({
    roleIds: z.array(z.int().positive())
});

const setResourceRolesParamsSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "post",
    path: "/resource/{resourceId}/roles",
    description:
        "Set roles for a resource. This will replace all existing roles. When the resource has an inline policy defined (no shared resource policy assigned), roles are set on the inline policy instead of directly on the resource.",
    tags: [OpenAPITags.PublicResource, OpenAPITags.Role],
    request: {
        params: setResourceRolesParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: setResourceRolesBodySchema
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

export async function setResourceRoles(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = setResourceRolesBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { roleIds } = parsedBody.data;

        const parsedParams = setResourceRolesParamsSchema.safeParse(req.params);
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
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Resource not found"
                )
            );
        }

        // Check if any of the roleIds are admin roles
        const rolesToCheck = await db
            .select()
            .from(roles)
            .where(
                and(
                    inArray(roles.roleId, roleIds),
                    eq(roles.orgId, resource.orgId)
                )
            );

        const hasAdminRole = rolesToCheck.some((role) => role.isAdmin);

        if (hasAdminRole) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Admin role cannot be assigned to resources"
                )
            );
        }

        // Get all admin role IDs for this org to exclude from deletion
        const adminRoles = await db
            .select()
            .from(roles)
            .where(
                and(eq(roles.isAdmin, true), eq(roles.orgId, resource.orgId))
            );
        const adminRoleIds = adminRoles.map((role) => role.roleId);

        const isInlinePolicy =
            resource.resourcePolicyId === null &&
            resource.defaultResourcePolicyId !== null;

        await db.transaction(async (trx) => {
            if (isInlinePolicy) {
                const policyId = resource.defaultResourcePolicyId!;

                // For inline policy, preserve admin roles by only deleting non-admin entries
                if (adminRoleIds.length > 0) {
                    await trx
                        .delete(rolePolicies)
                        .where(
                            and(
                                eq(rolePolicies.resourcePolicyId, policyId),
                                ne(rolePolicies.roleId, adminRoleIds[0])
                            )
                        );
                } else {
                    await trx
                        .delete(rolePolicies)
                        .where(eq(rolePolicies.resourcePolicyId, policyId));
                }

                await Promise.all(
                    roleIds.map((roleId) =>
                        trx
                            .insert(rolePolicies)
                            .values({ roleId, resourcePolicyId: policyId })
                            .returning()
                    )
                );
            } else {
                if (adminRoleIds.length > 0) {
                    await trx.delete(roleResources).where(
                        and(
                            eq(roleResources.resourceId, resourceId),
                            ne(roleResources.roleId, adminRoleIds[0]) // delete all but the admin role
                        )
                    );
                } else {
                    await trx
                        .delete(roleResources)
                        .where(eq(roleResources.resourceId, resourceId));
                }

                await Promise.all(
                    roleIds.map((roleId) =>
                        trx
                            .insert(roleResources)
                            .values({ roleId, resourceId })
                            .returning()
                    )
                );
            }

            return response(res, {
                data: {},
                success: true,
                error: false,
                message: "Roles set for resource successfully",
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
