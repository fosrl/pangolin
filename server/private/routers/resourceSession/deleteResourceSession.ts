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
import {
    db,
    resources,
    resourceSessionReauth,
    resourceSessions
} from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, eq } from "drizzle-orm";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty(),
    sessionId: z.string().nonempty()
});

registry.registerPath({
    method: "delete",
    path: "/org/{orgId}/resource-session/{sessionId}",
    description:
        "Revoke a resource session. The client will need to authenticate to the resource again. For SSO sessions, the user must log in again even if they are still logged in to the dashboard.",
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
            .select({
                sessionId: resourceSessions.sessionId,
                resourceId: resourceSessions.resourceId,
                userSessionId: resourceSessions.userSessionId
            })
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
        const { userSessionId, resourceId } = existing;
        await db.transaction(async (trx) => {
            if (!userSessionId) {
                await trx
                    .delete(resourceSessions)
                    .where(eq(resourceSessions.sessionId, existing.sessionId));
                return;
            }

            // A dashboard session gets a new resource session every time it
            // passes through the resource auth page, so revoke all of them
            // for this resource, and stop that dashboard session from
            // silently minting a new one until the user logs in again.
            await trx
                .delete(resourceSessions)
                .where(
                    and(
                        eq(resourceSessions.userSessionId, userSessionId),
                        eq(resourceSessions.resourceId, resourceId)
                    )
                );

            await trx
                .insert(resourceSessionReauth)
                .values({ userSessionId, resourceId, revokedAt: Date.now() })
                .onConflictDoNothing();
        });

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
