import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { roles, userOrgRoles } from "@server/db";
import { and, eq, exists, aliasedTable } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";

const deleteRoleSchema = z.strictObject({
    roleId: z.coerce.number().int().positive()
});

const deleteRoleBodySchema = z.strictObject({
    roleId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "delete",
    path: "/role/{roleId}",
    description: "Delete a role.",
    tags: [OpenAPITags.Role],
    request: {
        params: deleteRoleSchema,
        body: {
            content: {
                "application/json": {
                    schema: deleteRoleBodySchema
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

export async function deleteRole(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = deleteRoleSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const parsedBody = deleteRoleBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { roleId } = parsedParams.data;
        const { roleId: newRoleId } = parsedBody.data;

        if (roleId === newRoleId) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    `Cannot delete a role and assign the same role`
                )
            );
        }

        const role = await db
            .select()
            .from(roles)
            .where(eq(roles.roleId, roleId))
            .limit(1);

        if (role.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Role with ID ${roleId} not found`
                )
            );
        }

        if (role[0].isAdmin) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    `Cannot delete a Admin role`
                )
            );
        }

        const newRole = await db
            .select()
            .from(roles)
            .where(eq(roles.roleId, newRoleId))
            .limit(1);

        if (newRole.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Role with ID ${newRoleId} not found`
                )
            );
        }

        await db.transaction(async (trx) => {
            const uorNewRole = aliasedTable(userOrgRoles, "user_org_roles_new");

            // Users who already have newRoleId: drop the old assignment only (unique on userId+orgId+roleId).
            await trx.delete(userOrgRoles).where(
                and(
                    eq(userOrgRoles.roleId, roleId),
                    exists(
                        trx
                            .select()
                            .from(uorNewRole)
                            .where(
                                and(
                                    eq(uorNewRole.userId, userOrgRoles.userId),
                                    eq(uorNewRole.orgId, userOrgRoles.orgId),
                                    eq(uorNewRole.roleId, newRoleId)
                                )
                            )
                    )
                )
            );

            await trx
                .update(userOrgRoles)
                .set({ roleId: newRoleId })
                .where(eq(userOrgRoles.roleId, roleId));

            await trx.delete(roles).where(eq(roles.roleId, roleId));
        });

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Role deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
