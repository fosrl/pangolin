import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, type Role } from "@server/db";
import { roleActions, roles } from "@server/db";
import { and, eq } from "drizzle-orm";
import { ActionsEnum } from "@server/auth/actions";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";
import { OpenAPITags, registry } from "@server/openApi";
import { tierMatrix } from "@server/lib/billing/tierMatrix";

const updateRoleParamsSchema = z.strictObject({
    roleId: z.coerce.number().int().positive()
});

const sshSudoModeSchema = z.enum(["none", "full", "commands"]);

const updateRoleBodySchema = z
    .strictObject({
        name: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
        requireDeviceApproval: z.boolean().optional(),
        allowSsh: z.boolean().optional(),
        sshSudoMode: sshSudoModeSchema.optional(),
        sshSudoCommands: z.array(z.string()).optional(),
        sshCreateHomeDir: z.boolean().optional(),
        sshUnixGroups: z.array(z.string()).optional()
    })
    .refine((data) => Object.keys(data).length > 0, {
        error: "At least one field must be provided for update"
    });

export type UpdateRoleBody = z.infer<typeof updateRoleBodySchema>;

export type UpdateRoleResponse = Role;

registry.registerPath({
    method: "post",
    path: "/role/{roleId}",
    description: "Update a role.",
    tags: [OpenAPITags.Role],
    request: {
        params: updateRoleParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: updateRoleBodySchema
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

export async function updateRole(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = updateRoleParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const parsedBody = updateRoleBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { roleId } = parsedParams.data;
        const body = parsedBody.data;
        const { allowSsh, ...restBody } = body;
        const updateData: Record<string, unknown> = { ...restBody };

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

        const orgId = role[0].orgId;
        const isAdminRole = role[0].isAdmin;

        if (isAdminRole) {
            delete updateData.name;
            delete updateData.description;
        }

        if (!orgId) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Role does not have an organization ID"
                )
            );
        }

        const isLicensedDeviceApprovals = await isLicensedOrSubscribed(
            orgId,
            tierMatrix.deviceApprovals
        );
        if (!isLicensedDeviceApprovals) {
            updateData.requireDeviceApproval = undefined;
        }

        const isLicensedSshPam = await isLicensedOrSubscribed(
            orgId,
            tierMatrix.advancedPrivateResources
        );
        if (!isLicensedSshPam) {
            delete updateData.sshSudoMode;
            delete updateData.sshSudoCommands;
            delete updateData.sshCreateHomeDir;
            delete updateData.sshUnixGroups;
        } else {
            if (Array.isArray(updateData.sshSudoCommands)) {
                updateData.sshSudoCommands = JSON.stringify(
                    updateData.sshSudoCommands
                );
            }
            if (Array.isArray(updateData.sshUnixGroups)) {
                updateData.sshUnixGroups = JSON.stringify(
                    updateData.sshUnixGroups
                );
            }
        }

        const updatedRole = await db.transaction(async (trx) => {
            const result = await trx
                .update(roles)
                .set(updateData as typeof roles.$inferInsert)
                .where(eq(roles.roleId, roleId))
                .returning();

            if (result.length === 0) {
                return null;
            }

            if (allowSsh === true) {
                const existing = await trx
                    .select()
                    .from(roleActions)
                    .where(
                        and(
                            eq(roleActions.roleId, roleId),
                            eq(roleActions.actionId, ActionsEnum.signSshKey)
                        )
                    )
                    .limit(1);
                if (existing.length === 0) {
                    await trx.insert(roleActions).values({
                        roleId,
                        actionId: ActionsEnum.signSshKey,
                        orgId: orgId!
                    });
                }
            } else if (allowSsh === false) {
                await trx
                    .delete(roleActions)
                    .where(
                        and(
                            eq(roleActions.roleId, roleId),
                            eq(roleActions.actionId, ActionsEnum.signSshKey)
                        )
                    );
            }

            return result[0];
        });

        if (!updatedRole) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Role with ID ${roleId} not found`
                )
            );
        }

        return response(res, {
            data: updatedRole,
            success: true,
            error: false,
            message: "Role updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
