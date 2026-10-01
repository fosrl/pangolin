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
import { clientOrgRoles, clients, db, roles } from "@server/db";
import { and, eq } from "drizzle-orm";
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

const removeClientRoleParamsSchema = z.strictObject({
    clientId: z.coerce.number().int().positive(),
    roleId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "delete",
    path: "/client/{clientId}/remove-role/{roleId}",
    description:
        "Remove a role from a machine client. Unlike users, machine clients are not required to keep at least one role.",
    tags: [OpenAPITags.Role, OpenAPITags.Client],
    request: {
        params: removeClientRoleParamsSchema
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

export async function removeClientRole(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = removeClientRoleParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { clientId, roleId } = parsedParams.data;

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

        const [client] = await db
            .select()
            .from(clients)
            .where(eq(clients.clientId, clientId))
            .limit(1);

        if (!client || client.orgId !== role.orgId) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "Client not found or does not belong to the specified organization"
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

        await db
            .delete(clientOrgRoles)
            .where(
                and(
                    eq(clientOrgRoles.clientId, clientId),
                    eq(clientOrgRoles.orgId, role.orgId),
                    eq(clientOrgRoles.roleId, roleId)
                )
            );

        rebuildClientAssociationsFromClient(client).catch((e) => {
            logger.error(
                `Failed to rebuild client associations for client ${clientId} after removing role: ${e}`
            );
        });

        return response(res, {
            data: { clientId, orgId: role.orgId, roleId },
            success: true,
            error: false,
            message: "Role removed from client successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
