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

const addRoleToResourceBodySchema = z
    .object({
        roleId: z.number().int().positive()
    })
    .strict();

const addRoleToResourceParamsSchema = z
    .object({
        resourceId: z
            .string()
            .transform(Number)
            .pipe(z.number().int().positive())
    })
    .strict();

registry.registerPath({
    method: "post",
    path: "/resource/{resourceId}/roles/add",
    description:
        "Add a single role to a resource. When the resource has an inline policy defined (no shared resource policy assigned), the role is added to the inline policy instead of directly to the resource.",
    tags: [OpenAPITags.PublicResource, OpenAPITags.Role],
    request: {
        params: addRoleToResourceParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: addRoleToResourceBodySchema
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

export async function addRoleToResource(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = addRoleToResourceBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { roleId } = parsedBody.data;

        const parsedParams = addRoleToResourceParamsSchema.safeParse(
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

        // verify the role exists and belongs to the same org
        const [role] = await db
            .select()
            .from(roles)
            .where(
                and(eq(roles.roleId, roleId), eq(roles.orgId, resource.orgId))
            )
            .limit(1);

        if (!role) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "Role not found or does not belong to the same organization"
                )
            );
        }

        // Check if the role is an admin role
        if (role.isAdmin) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Admin role cannot be assigned to resources"
                )
            );
        }

        const isInlinePolicy =
            resource.resourcePolicyId === null &&
            resource.defaultResourcePolicyId !== null;

        if (isInlinePolicy) {
            const policyId = resource.defaultResourcePolicyId!;

            // Check if role already exists in the inline policy
            const existingEntry = await db
                .select()
                .from(rolePolicies)
                .where(
                    and(
                        eq(rolePolicies.resourcePolicyId, policyId),
                        eq(rolePolicies.roleId, roleId)
                    )
                );

            if (existingEntry.length > 0) {
                return next(
                    createHttpError(
                        HttpCode.CONFLICT,
                        "Role already assigned to resource"
                    )
                );
            }

            await db.insert(rolePolicies).values({
                roleId,
                resourcePolicyId: policyId
            });
        } else {
            // Check if role already exists in resource
            const existingEntry = await db
                .select()
                .from(roleResources)
                .where(
                    and(
                        eq(roleResources.resourceId, resourceId),
                        eq(roleResources.roleId, roleId)
                    )
                );

            if (existingEntry.length > 0) {
                return next(
                    createHttpError(
                        HttpCode.CONFLICT,
                        "Role already assigned to resource"
                    )
                );
            }

            await db.insert(roleResources).values({
                roleId,
                resourceId
            });
        }

        return response(res, {
            data: {},
            success: true,
            error: false,
            message: "Role added to resource successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
