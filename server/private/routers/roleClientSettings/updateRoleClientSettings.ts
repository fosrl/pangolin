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
import { db, roleClientSettings, roles, siteResources } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, eq } from "drizzle-orm";
import type { UpdateRoleClientSettingsResponse } from "@server/routers/role/types";

const paramsSchema = z.strictObject({
    roleId: z.coerce.number().int().positive()
});

const dnsServerSchema = z.union([z.ipv4(), z.ipv6()]).nullable();

const bodySchema = z.strictObject({
    enabled: z.boolean(),
    overrideDns: z.boolean().nullable(),
    mtu: z.number().int().min(576).max(65535).nullable(),
    tunnelDns: z.boolean().nullable(),
    primaryDns: dnsServerSchema,
    secondaryDns: dnsServerSchema,
    exitNodeTakesPrecedence: z.boolean().nullable(),
    exitNodeSiteResourceId: z.number().int().positive().nullable(),
    exitNodeLocked: z.boolean(),
    matchDomains: z
        .array(z.string().trim().min(1).max(255))
        .max(256)
        .nullable(),
    preferLocalRoutes: z.boolean().nullable()
});

export type UpdateRoleClientSettingsBody = z.infer<typeof bodySchema>;

registry.registerPath({
    method: "post",
    path: "/role/{roleId}/client-settings",
    description: "Update the client settings applied to a role's members.",
    tags: [OpenAPITags.Role],
    request: {
        params: paramsSchema,
        body: {
            content: {
                "application/json": {
                    schema: bodySchema
                }
            }
        }
    },
    responses: {
        200: { description: "Successful response" }
    }
});

export async function updateRoleClientSettings(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = paramsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const parsedBody = bodySchema.safeParse(req.body);
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

        const [role] = await db
            .select()
            .from(roles)
            .where(eq(roles.roleId, roleId))
            .limit(1);

        if (!role) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Role with ID ${roleId} not found`
                )
            );
        }

        if (body.exitNodeSiteResourceId !== null) {
            const [gateway] = await db
                .select({ siteResourceId: siteResources.siteResourceId })
                .from(siteResources)
                .where(
                    and(
                        eq(
                            siteResources.siteResourceId,
                            body.exitNodeSiteResourceId
                        ),
                        eq(siteResources.orgId, role.orgId),
                        eq(siteResources.mode, "gateway")
                    )
                )
                .limit(1);

            if (!gateway) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Exit node must be a gateway resource in this organization"
                    )
                );
            }
        }

        const values = {
            ...body,
            exitNodeLocked:
                body.exitNodeSiteResourceId !== null && body.exitNodeLocked,
            matchDomains: body.matchDomains?.length
                ? JSON.stringify(body.matchDomains)
                : null
        };

        await db
            .insert(roleClientSettings)
            .values({ roleId, orgId: role.orgId, ...values })
            .onConflictDoUpdate({
                target: roleClientSettings.roleId,
                set: values
            });

        return response<UpdateRoleClientSettingsResponse>(res, {
            data: {
                ...body,
                exitNodeLocked: values.exitNodeLocked,
                matchDomains: body.matchDomains?.length
                    ? body.matchDomains
                    : null
            },
            success: true,
            error: false,
            message: "Role client settings updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
