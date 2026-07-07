/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025-2026 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import stoi from "@server/lib/stoi";
import { db, primaryDb, Client } from "@server/db";
import { userOrgRoles, userOrgs, roles, clients } from "@server/db";
import { eq, and } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { rebuildClientAssociationsFromClient } from "@server/lib/rebuildClientAssociations";

const removeUserRoleParamsSchema = z.strictObject({
    userId: z.string(),
    roleId: z.coerce.number()
});

registry.registerPath({
    method: "delete",
    path: "/user/{userId}/remove-role/{roleId}",
    description:
        "Remove a role from a user. User must have at least one role left in the org.",
    tags: [OpenAPITags.Role, OpenAPITags.User],
    request: {
        params: removeUserRoleParamsSchema
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

export async function removeUserRole(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = removeUserRoleParamsSchema.safeParse(req.params);
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

        if (existingUser.isOwner && role.isAdmin === true) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "Cannot remove the administrator role from the organization owner"
                )
            );
        }

        const remainingRoles = await db
            .select({ roleId: userOrgRoles.roleId })
            .from(userOrgRoles)
            .where(
                and(
                    eq(userOrgRoles.userId, userId),
                    eq(userOrgRoles.orgId, role.orgId)
                )
            );

        if (remainingRoles.length <= 1) {
            const hasThisRole = remainingRoles.some((r) => r.roleId === roleId);
            if (hasThisRole) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "User must have at least one role in the organization. Remove the last role is not allowed."
                    )
                );
            }
        }

        let orgClientsToRebuild: Client[] = [];
        await db.transaction(async (trx) => {
            await trx
                .delete(userOrgRoles)
                .where(
                    and(
                        eq(userOrgRoles.userId, userId),
                        eq(userOrgRoles.orgId, role.orgId),
                        eq(userOrgRoles.roleId, roleId)
                    )
                );

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
                    `Failed to rebuild client associations for client ${orgClient.clientId} after removing role: ${e}`
                );
            });
        }

        return response(res, {
            data: { userId, orgId: role.orgId, roleId },
            success: true,
            error: false,
            message: "Role removed from user successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
