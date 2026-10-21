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
import { and, eq, inArray } from "drizzle-orm";
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

const setClientRolesParamsSchema = z.strictObject({
    clientId: z.coerce.number().int().positive()
});

const setClientRolesBodySchema = z.strictObject({
    roleIds: z.array(z.int().positive())
});

registry.registerPath({
    method: "post",
    path: "/client/{clientId}/roles",
    description:
        "Set all roles for a machine client, replacing any existing roles. An empty list removes all roles. Clients with a userId cannot be assigned roles; they inherit the roles of their user.",
    tags: [OpenAPITags.Role, OpenAPITags.Client],
    request: {
        params: setClientRolesParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: setClientRolesBodySchema
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

export async function setClientRoles(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = setClientRolesParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const parsedBody = setClientRolesBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { clientId } = parsedParams.data;
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

        const [client] = await db
            .select()
            .from(clients)
            .where(eq(clients.clientId, clientId))
            .limit(1);

        if (!client) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Client not found")
            );
        }

        if (client.userId !== null) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Cannot set roles on clients that are associated with a user"
                )
            );
        }

        const orgId = client.orgId;

        if (uniqueRoleIds.length > 0) {
            const orgRoles = await db
                .select({ roleId: roles.roleId })
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
        }

        if (await isOrgRebuildRateLimited(orgId)) {
            return next(
                createHttpError(
                    HttpCode.TOO_MANY_REQUESTS,
                    "Too many concurrent rebuild operations for this organization. Please retry after a moment."
                )
            );
        }

        await db.transaction(async (trx) => {
            await trx
                .delete(clientOrgRoles)
                .where(
                    and(
                        eq(clientOrgRoles.clientId, clientId),
                        eq(clientOrgRoles.orgId, orgId)
                    )
                );

            if (uniqueRoleIds.length > 0) {
                await trx.insert(clientOrgRoles).values(
                    uniqueRoleIds.map((roleId) => ({
                        clientId,
                        orgId,
                        roleId
                    }))
                );
            }
        });

        rebuildClientAssociationsFromClient(client).catch((e) => {
            logger.error(
                `Failed to rebuild client associations for client ${clientId} after setting roles: ${e}`
            );
        });

        return response(res, {
            data: { clientId, orgId, roleIds: uniqueRoleIds },
            success: true,
            error: false,
            message: "Client roles set successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
