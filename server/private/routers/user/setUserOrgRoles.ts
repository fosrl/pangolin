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
import { clients, db, primaryDb, Client } from "@server/db";
import { userOrgRoles, userOrgs, roles } from "@server/db";
import { eq, and, inArray } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import {
    rebuildClientAssociationsFromClient,
    isOrgRebuildRateLimited
} from "@server/lib/rebuildClientAssociations";

const setUserOrgRolesParamsSchema = z.strictObject({
    orgId: z.string(),
    userId: z.string()
});

const setUserOrgRolesBodySchema = z.strictObject({
    roleIds: z.array(z.int().positive()).min(1)
});

export async function setUserOrgRoles(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = setUserOrgRolesParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const parsedBody = setUserOrgRolesBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { orgId, userId } = parsedParams.data;
        const { roleIds } = parsedBody.data;

        if (req.user && !req.userOrg) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "You do not have access to this organization"
                )
            );
        }

        const uniqueRoleIds = [...new Set(roleIds)];

        const [existingUser] = await db
            .select()
            .from(userOrgs)
            .where(and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, orgId)))
            .limit(1);

        if (!existingUser) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "User not found in this organization"
                )
            );
        }

        if (await isOrgRebuildRateLimited(orgId)) {
            return next(
                createHttpError(
                    HttpCode.TOO_MANY_REQUESTS,
                    "Too many concurrent rebuild operations for this organization. Please retry after a moment."
                )
            );
        }

        const orgRoles = await db
            .select({ roleId: roles.roleId, isAdmin: roles.isAdmin })
            .from(roles)
            .where(
                and(
                    eq(roles.orgId, orgId),
                    inArray(roles.roleId, uniqueRoleIds)
                )
            );

        if (orgRoles.length !== uniqueRoleIds.length) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "One or more role IDs are invalid for this organization"
                )
            );
        }

        if (existingUser.isOwner) {
            const hasAdminRole = orgRoles.some((r) => r.isAdmin === true);
            if (!hasAdminRole) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "The organization owner must retain an administrator role"
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
                        eq(userOrgRoles.orgId, orgId)
                    )
                );

            if (uniqueRoleIds.length > 0) {
                await trx.insert(userOrgRoles).values(
                    uniqueRoleIds.map((roleId) => ({
                        userId,
                        orgId,
                        roleId
                    }))
                );
            }

            const orgClients = await trx
                .select()
                .from(clients)
                .where(
                    and(eq(clients.userId, userId), eq(clients.orgId, orgId))
                );

            orgClientsToRebuild = orgClients;
        });

        for (const orgClient of orgClientsToRebuild) {
            rebuildClientAssociationsFromClient(orgClient).catch((e) => {
                logger.error(
                    `Failed to rebuild client associations for client ${orgClient.clientId} after setting roles: ${e}`
                );
            });
        }

        return response(res, {
            data: { userId, orgId, roleIds: uniqueRoleIds },
            success: true,
            error: false,
            message: "User roles set successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
