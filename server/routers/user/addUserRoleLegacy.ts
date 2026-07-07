import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import stoi from "@server/lib/stoi";
import { clients, db, primaryDb, Client } from "@server/db";
import { userOrgRoles, userOrgs, roles } from "@server/db";
import { eq, and } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import {
    rebuildClientAssociationsFromClient,
    isOrgRebuildRateLimited
} from "@server/lib/rebuildClientAssociations";

/** Legacy path param order: /role/:roleId/add/:userId */
const addUserRoleLegacyParamsSchema = z.strictObject({
    roleId: z.coerce.number(),
    userId: z.string()
});

registry.registerPath({
    method: "post",
    path: "/role/{roleId}/add/{userId}",
    description:
        "Legacy: set exactly one role for the user (replaces any other roles the user has in the org).",
    tags: [OpenAPITags.Role, OpenAPITags.User],
    request: {
        params: addUserRoleLegacyParamsSchema
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

export async function addUserRoleLegacy(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = addUserRoleLegacyParamsSchema.safeParse(
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

        const { userId, roleId } = parsedParams.data;

        if (req.user && !req.userOrg) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "You do not have access to this organization"
                )
            );
        }

        const [role] = await db
            .select()
            .from(roles)
            .where(eq(roles.roleId, roleId))
            .limit(1);

        if (!role) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid role ID")
            );
        }

        const [existingUser] = await db
            .select()
            .from(userOrgs)
            .where(
                and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, role.orgId))
            )
            .limit(1);

        if (!existingUser) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "User not found or does not belong to the specified organization"
                )
            );
        }

        if (existingUser.isOwner && role.isAdmin !== true) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "The organization owner must retain an administrator role"
                )
            );
        }

        const [roleInOrg] = await db
            .select()
            .from(roles)
            .where(and(eq(roles.roleId, roleId), eq(roles.orgId, role.orgId)))
            .limit(1);

        if (!roleInOrg) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "Role not found or does not belong to the specified organization"
                )
            );
        }

        if (await isOrgRebuildRateLimited(role.orgId)) {
            return next(
                createHttpError(
                    HttpCode.TOO_MANY_REQUESTS,
                    "Too many concurrent rebuild operations for this organization. Please retry after a moment."
                )
            );
        }

        let orgClientsToRebuild: Client[] = [];

        await db.transaction(async (trx) => {
            await trx
                .delete(userOrgRoles)
                .where(
                    and(
                        eq(userOrgRoles.userId, userId),
                        eq(userOrgRoles.orgId, role.orgId)
                    )
                );

            await trx.insert(userOrgRoles).values({
                userId,
                orgId: role.orgId,
                roleId
            });

            const orgClients = await trx
                .select()
                .from(clients)
                .where(
                    and(
                        eq(clients.userId, userId),
                        eq(clients.orgId, role.orgId)
                    )
                );

            orgClientsToRebuild = orgClients;
        });

        for (const orgClient of orgClientsToRebuild) {
            rebuildClientAssociationsFromClient(orgClient).catch((e) => {
                logger.error(
                    `Failed to rebuild client associations for client ${orgClient.clientId} after adding role: ${e}`
                );
            });
        }

        return response(res, {
            data: { ...existingUser, roleId },
            success: true,
            error: false,
            message: "Role added to user successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
