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
import { db, resources, resourceSessions } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, eq } from "drizzle-orm";
import { invalidateResourceSession } from "@server/auth/sessions/resource";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty(),
    sessionId: z.string().nonempty()
});

registry.registerPath({
    method: "delete",
    path: "/org/{orgId}/resource-session/{sessionId}",
    description:
        "Revoke a resource session. The client will need to authenticate to the resource again.",
    tags: [OpenAPITags.ResourceSession],
    request: {
        params: paramsSchema
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

export async function deleteResourceSession(
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

        const { orgId, sessionId } = parsedParams.data;

        // Scope the lookup to the org so a session id from another org is
        // indistinguishable from one that doesn't exist.
        const [existing] = await db
            .select({ sessionId: resourceSessions.sessionId })
            .from(resourceSessions)
            .innerJoin(
                resources,
                eq(resources.resourceId, resourceSessions.resourceId)
            )
            .where(
                and(
                    eq(resourceSessions.sessionId, sessionId),
                    eq(resources.orgId, orgId)
                )
            )
            .limit(1);

        if (!existing) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "Resource session not found"
                )
            );
        }

        // verifySession caches validated sessions by token for a few seconds,
        // so the revocation takes effect once that entry expires.
        await invalidateResourceSession(existing.sessionId);

        return response<null>(res, {
            data: null,
            success: true,
            error: false,
            message: "Resource session revoked successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
