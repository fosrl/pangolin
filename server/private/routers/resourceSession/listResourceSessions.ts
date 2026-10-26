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
    alias,
    db,
    resourceAccessToken,
    resourcePolicyWhiteList,
    resources,
    resourceSessions,
    resourceWhitelist,
    sessions,
    users
} from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import type {
    ListResourceSessionsResponse,
    ResourceSessionAuthMethod
} from "@server/routers/resourceSession/types";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty()
});

const querySchema = z.strictObject({
    limit: z
        .string()
        .optional()
        .default("1000")
        .transform(Number)
        .pipe(z.number().int().nonnegative()),
    offset: z
        .string()
        .optional()
        .default("0")
        .transform(Number)
        .pipe(z.number().int().nonnegative()),
    resourceId: z
        .string()
        .optional()
        .transform((v) => (v !== undefined ? Number(v) : undefined))
        .pipe(z.number().int().positive().optional())
});

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/resource-sessions",
    description:
        "List active resource sessions for all public resources in an organization.",
    tags: [OpenAPITags.ResourceSession],
    request: {
        query: querySchema,
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

export async function listResourceSessions(
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
        const { orgId } = parsedParams.data;

        const parsedQuery = querySchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error).toString()
                )
            );
        }
        const { limit, offset, resourceId } = parsedQuery.data;

        // Request tokens are short-lived exchange tokens, not usable sessions,
        // and expired rows are only cleaned up lazily, so hide both.
        const whereClause = and(
            eq(resources.orgId, orgId),
            gt(resourceSessions.expiresAt, Date.now()),
            or(
                isNull(resourceSessions.isRequestToken),
                eq(resourceSessions.isRequestToken, false)
            ),
            resourceId !== undefined
                ? eq(resourceSessions.resourceId, resourceId)
                : undefined
        );

        // SSO sessions resolve the user through the user session, access
        // token sessions through the token owner.
        const tokenUsers = alias(users, "tokenUsers");

        const [rows, [{ count }]] = await Promise.all([
            db
                .select({
                    sessionId: resourceSessions.sessionId,
                    resourceId: resourceSessions.resourceId,
                    resourceName: resources.name,
                    resourceNiceId: resources.niceId,
                    issuedAt: resourceSessions.issuedAt,
                    expiresAt: resourceSessions.expiresAt,
                    userSessionId: resourceSessions.userSessionId,
                    passwordId: resourceSessions.passwordId,
                    pincodeId: resourceSessions.pincodeId,
                    whitelistId: resourceSessions.whitelistId,
                    accessTokenId: resourceSessions.accessTokenId,
                    policyPasswordId: resourceSessions.policyPasswordId,
                    policyPincodeId: resourceSessions.policyPincodeId,
                    policyWhitelistId: resourceSessions.policyWhitelistId,
                    ssoUserId: users.userId,
                    ssoUsername: users.username,
                    ssoName: users.name,
                    ssoEmail: users.email,
                    tokenUserId: tokenUsers.userId,
                    tokenUsername: tokenUsers.username,
                    tokenName: tokenUsers.name,
                    tokenEmail: tokenUsers.email,
                    accessTokenTitle: resourceAccessToken.title,
                    whitelistEmail: resourceWhitelist.email,
                    policyWhitelistEmail: resourcePolicyWhiteList.email
                })
                .from(resourceSessions)
                .innerJoin(
                    resources,
                    eq(resources.resourceId, resourceSessions.resourceId)
                )
                .leftJoin(
                    sessions,
                    eq(sessions.sessionId, resourceSessions.userSessionId)
                )
                .leftJoin(users, eq(users.userId, sessions.userId))
                .leftJoin(
                    resourceAccessToken,
                    eq(
                        resourceAccessToken.accessTokenId,
                        resourceSessions.accessTokenId
                    )
                )
                .leftJoin(
                    tokenUsers,
                    eq(tokenUsers.userId, resourceAccessToken.userId)
                )
                .leftJoin(
                    resourceWhitelist,
                    eq(
                        resourceWhitelist.whitelistId,
                        resourceSessions.whitelistId
                    )
                )
                .leftJoin(
                    resourcePolicyWhiteList,
                    eq(
                        resourcePolicyWhiteList.whitelistId,
                        resourceSessions.policyWhitelistId
                    )
                )
                .where(whereClause)
                .orderBy(desc(resourceSessions.issuedAt))
                .limit(limit)
                .offset(offset),
            db
                .select({ count: sql<number>`count(*)` })
                .from(resourceSessions)
                .innerJoin(
                    resources,
                    eq(resources.resourceId, resourceSessions.resourceId)
                )
                .where(whereClause)
        ]);

        return response<ListResourceSessionsResponse>(res, {
            data: {
                sessions: rows.map((row) => ({
                    sessionId: row.sessionId,
                    resourceId: row.resourceId,
                    resourceName: row.resourceName,
                    resourceNiceId: row.resourceNiceId,
                    authMethod: getAuthMethod(row),
                    issuedAt: row.issuedAt ?? null,
                    expiresAt: row.expiresAt,
                    user: row.ssoUserId
                        ? {
                              userId: row.ssoUserId,
                              username: row.ssoUsername!,
                              name: row.ssoName,
                              email: row.ssoEmail
                          }
                        : row.tokenUserId
                          ? {
                                userId: row.tokenUserId,
                                username: row.tokenUsername!,
                                name: row.tokenName,
                                email: row.tokenEmail
                            }
                          : null,
                    email:
                        row.whitelistEmail ?? row.policyWhitelistEmail ?? null,
                    accessTokenId: row.accessTokenId ?? null,
                    accessTokenTitle: row.accessTokenTitle ?? null
                })),
                pagination: {
                    total: Number(count),
                    limit,
                    offset
                }
            },
            success: true,
            error: false,
            message: "Resource sessions retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}

function getAuthMethod(row: {
    userSessionId: string | null;
    passwordId: number | null;
    pincodeId: number | null;
    whitelistId: number | null;
    accessTokenId: string | null;
    policyPasswordId: number | null;
    policyPincodeId: number | null;
    policyWhitelistId: number | null;
}): ResourceSessionAuthMethod | null {
    if (row.userSessionId) return "sso";
    if (row.accessTokenId) return "accessToken";
    if (row.whitelistId || row.policyWhitelistId) return "whitelist";
    if (row.passwordId || row.policyPasswordId) return "password";
    if (row.pincodeId || row.policyPincodeId) return "pincode";
    return null;
}
