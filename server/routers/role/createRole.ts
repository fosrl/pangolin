import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { orgs, Role, roleActions, roles } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { ActionsEnum } from "@server/auth/actions";
import { eq, and } from "drizzle-orm";
import { OpenAPITags, registry } from "@server/openApi";
import { build } from "@server/build";
import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";
import { tierMatrix } from "@server/lib/billing/tierMatrix";

const createRoleParamsSchema = z.strictObject({
    orgId: z.string()
});

const sshSudoModeSchema = z.enum(["none", "full", "commands"]);

const createRoleSchema = z.strictObject({
    name: z.string().min(1).max(255),
    description: z.string().optional(),
    requireDeviceApproval: z.boolean().optional(),
    allowSsh: z.boolean().optional(),
    sshSudoMode: sshSudoModeSchema.optional(),
    sshSudoCommands: z.array(z.string()).optional(),
    sshCreateHomeDir: z.boolean().optional(),
    sshUnixGroups: z.array(z.string()).optional()
});

export const defaultRoleAllowedActions: ActionsEnum[] = [
    ActionsEnum.getOrg,
    ActionsEnum.getResource,
    ActionsEnum.listResources
];

export type CreateRoleBody = z.infer<typeof createRoleSchema>;

export type CreateRoleResponse = Role;

registry.registerPath({
    method: "put",
    path: "/org/{orgId}/role",
    description: "Create a role.",
    tags: [OpenAPITags.Role],
    request: {
        params: createRoleParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: createRoleSchema
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

export async function createRole(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = createRoleSchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const roleData = parsedBody.data;

        const parsedParams = createRoleParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { orgId } = parsedParams.data;

        const allRoles = await db
            .select({
                roleId: roles.roleId,
                name: roles.name
            })
            .from(roles)
            .leftJoin(orgs, eq(roles.orgId, orgs.orgId))
            .where(and(eq(roles.name, roleData.name), eq(roles.orgId, orgId)));

        // make sure name is unique
        if (allRoles.length > 0) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Role with that name already exists"
                )
            );
        }

        const isLicensedDeviceApprovals = await isLicensedOrSubscribed(
            orgId,
            tierMatrix.deviceApprovals
        );
        if (!isLicensedDeviceApprovals) {
            roleData.requireDeviceApproval = undefined;
        }

        const isLicensedSshPam = await isLicensedOrSubscribed(
            orgId,
            tierMatrix.advancedPrivateResources
        );
        const roleInsertValues: Record<string, unknown> = {
            name: roleData.name,
            orgId
        };
        if (roleData.description !== undefined)
            roleInsertValues.description = roleData.description;
        if (roleData.requireDeviceApproval !== undefined)
            roleInsertValues.requireDeviceApproval =
                roleData.requireDeviceApproval;
        if (isLicensedSshPam) {
            if (roleData.sshSudoMode !== undefined)
                roleInsertValues.sshSudoMode = roleData.sshSudoMode;
            if (roleData.sshSudoCommands !== undefined)
                roleInsertValues.sshSudoCommands = JSON.stringify(
                    roleData.sshSudoCommands
                );
            if (roleData.sshCreateHomeDir !== undefined)
                roleInsertValues.sshCreateHomeDir = roleData.sshCreateHomeDir;
            if (roleData.sshUnixGroups !== undefined)
                roleInsertValues.sshUnixGroups = JSON.stringify(
                    roleData.sshUnixGroups
                );
        }

        await db.transaction(async (trx) => {
            const newRole = await trx
                .insert(roles)
                .values(roleInsertValues as typeof roles.$inferInsert)
                .returning();

            const actionsToInsert = [...defaultRoleAllowedActions];
            if (roleData.allowSsh) {
                actionsToInsert.push(ActionsEnum.signSshKey);
            }

            await trx
                .insert(roleActions)
                .values(
                    actionsToInsert.map((action) => ({
                        roleId: newRole[0].roleId,
                        actionId: action,
                        orgId
                    }))
                )
                .execute();

            return response<Role>(res, {
                data: newRole[0],
                success: true,
                error: false,
                message: "Role created successfully",
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
