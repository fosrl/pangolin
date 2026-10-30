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
import { db, roleClientSettings } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { eq } from "drizzle-orm";
import { parseMatchDomains } from "#private/lib/clientSettings";
import type { GetRoleClientSettingsResponse } from "@server/routers/role/types";

const paramsSchema = z.strictObject({
    roleId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "get",
    path: "/role/{roleId}/client-settings",
    description: "Get the client settings applied to a role's members.",
    tags: [OpenAPITags.Role],
    request: {
        params: paramsSchema
    },
    responses: {
        200: { description: "Successful response" }
    }
});

export async function getRoleClientSettings(
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

        const { roleId } = parsedParams.data;

        const [row] = await db
            .select()
            .from(roleClientSettings)
            .where(eq(roleClientSettings.roleId, roleId))
            .limit(1);

        return response<GetRoleClientSettingsResponse>(res, {
            data: {
                enabled: row?.enabled ?? false,
                overrideDns: row?.overrideDns ?? null,
                mtu: row?.mtu ?? null,
                tunnelDns: row?.tunnelDns ?? null,
                primaryDns: row?.primaryDns ?? null,
                secondaryDns: row?.secondaryDns ?? null,
                exitNodeTakesPrecedence: row?.exitNodeTakesPrecedence ?? null,
                exitNodeSiteResourceId: row?.exitNodeSiteResourceId ?? null,
                exitNodeLocked: row?.exitNodeLocked ?? false,
                matchDomains:
                    parseMatchDomains(row?.matchDomains ?? null) ?? null,
                preferLocalRoutes: row?.preferLocalRoutes ?? null
            },
            success: true,
            error: false,
            message: "Role client settings retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
