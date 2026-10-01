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
import { eq } from "drizzle-orm";
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

const addClientRoleParamsSchema = z.strictObject({
    clientId: z.coerce.number().int().positive(),
    roleId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "post",
    path: "/client/{clientId}/add-role/{roleId}",
    description:
        "Add a role to a machine client. The client is granted access to the private resources assigned to the role. Clients with a userId cannot be added to roles; they inherit the roles of their user.",
    tags: [OpenAPITags.Role, OpenAPITags.Client],
    request: {
        params: addClientRoleParamsSchema
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

export async function addClientRole(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = addClientRoleParamsSchema.safeParse(req.params);
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

        if (client.userId !== null) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Cannot add roles to clients that are associated with a user"
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
            .insert(clientOrgRoles)
            .values({
                clientId,
                orgId: role.orgId,
                roleId
            })
            .onConflictDoNothing();

        rebuildClientAssociationsFromClient(client).catch((e) => {
            logger.error(
                `Failed to rebuild client associations for client ${clientId} after adding role: ${e}`
            );
        });

        return response(res, {
            data: { clientId, orgId: role.orgId, roleId },
            success: true,
            error: false,
            message: "Role added to client successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
