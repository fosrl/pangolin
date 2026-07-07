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

const addUserRoleParamsSchema = z.strictObject({
    userId: z.string(),
    roleId: z.coerce.number()
});

registry.registerPath({
    method: "post",
    path: "/user/{userId}/add-role/{roleId}",
    description: "Add a role to a user.",
    tags: [OpenAPITags.Role, OpenAPITags.User],
    request: {
        params: addUserRoleParamsSchema
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

export async function addUserRole(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = addUserRoleParamsSchema.safeParse(req.params);
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

        // get the role
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

        const existingUser = await db
            .select()
            .from(userOrgs)
            .where(
                and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, role.orgId))
            )
            .limit(1);

        if (existingUser.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "User not found or does not belong to the specified organization"
                )
            );
        }

        const roleExists = await db
            .select()
            .from(roles)
            .where(and(eq(roles.roleId, roleId), eq(roles.orgId, role.orgId)))
            .limit(1);

        if (roleExists.length === 0) {
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

        let newUserRole: {
            userId: string;
            orgId: string;
            roleId: number;
        } | null = null;
        let orgClientsToRebuild: Client[] = [];
        await db.transaction(async (trx) => {
            const inserted = await trx
                .insert(userOrgRoles)
                .values({
                    userId,
                    orgId: role.orgId,
                    roleId
                })
                .onConflictDoNothing()
                .returning();

            if (inserted.length > 0) {
                newUserRole = inserted[0];
            }

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
            data: newUserRole ?? { userId, orgId: role.orgId, roleId },
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
