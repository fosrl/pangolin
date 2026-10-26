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
import {
    and,
    asc,
    desc,
    eq,
    gt,
    inArray,
    isNotNull,
    isNull,
    like,
    or,
    sql,
    type SQL
} from "drizzle-orm";
import {
    resourceSessionAuthMethods,
    type ListResourceSessionsResponse,
    type ResourceSessionAuthMethod
} from "@server/routers/resourceSession/types";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty()
});

const listSchema = z.object({
    pageSize: z.coerce
        .number<string>()
        .int()
        .positive()
        .optional()
        .catch(20)
        .default(20)
        .openapi({
            type: "integer",
            default: 20,
            description: "Number of items per page"
        }),
    page: z.coerce
        .number<string>()
        .int()
        .min(0)
        .optional()
        .catch(1)
        .default(1)
        .openapi({
            type: "integer",
            default: 1,
            description: "Page number to retrieve"
        }),
    query: z.string().optional().openapi({
        type: "string",
        description:
            "Search by user, email, shareable link title, or resource name"
    }),
    sort_by: z
        .enum(["issuedAt", "expiresAt"])
        .optional()
        .catch(undefined)
        .openapi({
            type: "string",
            enum: ["issuedAt", "expiresAt"],
            description: "Field to sort by"
        }),
    order: z
        .enum(["asc", "desc"])
        .optional()
        .default("desc")
        .catch("desc")
        .openapi({
            type: "string",
            enum: ["asc", "desc"],
            default: "desc",
            description: "Sort order"
        }),
    resourceId: z.coerce
        .number<string>()
        .int()
        .positive()
        .optional()
        .catch(undefined)
        .openapi({
            type: "integer",
            description: "Filter sessions for this resource"
        }),
    userId: z.string().nonempty().optional().catch(undefined).openapi({
        type: "string",
        description:
            "Filter sessions held by this user, through SSO or a shareable link"
    }),
    authMethod: z
        .enum(resourceSessionAuthMethods)
        .optional()
        .catch(undefined)
        .openapi({
            type: "string",
            enum: [...resourceSessionAuthMethods],
            description: "Filter sessions by how they were authenticated"
        }),
    sessionId: z.string().nonempty().optional().catch(undefined).openapi({
        type: "string",
        description:
            "Find a single session. Also matches the id of the login request it was created from, as recorded in the access logs."
    })
});

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/resource-sessions",
    description:
        "List active resource sessions for all public resources in an organization.",
    tags: [OpenAPITags.ResourceSession],
    request: {
        params: paramsSchema,
        query: listSchema
    },
    responses: {
        200: {
            description: "Successful response"
        }
    }
});

function authMethodCondition(method: ResourceSessionAuthMethod): SQL {
    switch (method) {
        case "sso":
            return isNotNull(resourceSessions.userSessionId);
        case "accessToken":
            return isNotNull(resourceSessions.accessTokenId);
        case "whitelist":
            return or(
                isNotNull(resourceSessions.whitelistId),
                isNotNull(resourceSessions.policyWhitelistId)
            )!;
        case "password":
            return or(
                isNotNull(resourceSessions.passwordId),
                isNotNull(resourceSessions.policyPasswordId)
            )!;
        case "pincode":
            return or(
                isNotNull(resourceSessions.pincodeId),
                isNotNull(resourceSessions.policyPincodeId)
            )!;
    }
}

// SSO sessions belong to the user behind the dashboard session; shareable
// link sessions to the user the link was created for.
function userCondition(userId: string): SQL {
    return or(
        inArray(
            resourceSessions.userSessionId,
            db
                .select({ sessionId: sessions.sessionId })
                .from(sessions)
                .where(eq(sessions.userId, userId))
        ),
        inArray(
            resourceSessions.accessTokenId,
            db
                .select({ accessTokenId: resourceAccessToken.accessTokenId })
                .from(resourceAccessToken)
                .where(eq(resourceAccessToken.userId, userId))
        )
    )!;
}

function searchCondition(query: string): SQL {
    const term = "%" + query.toLowerCase() + "%";
    const matchesUser = or(
        like(sql`LOWER(${users.email})`, term),
        like(sql`LOWER(${users.username})`, term),
        like(sql`LOWER(${users.name})`, term)
    );

    return or(
        like(sql`LOWER(${resources.name})`, term),
        inArray(
            resourceSessions.userSessionId,
            db
                .select({ sessionId: sessions.sessionId })
                .from(sessions)
                .innerJoin(users, eq(users.userId, sessions.userId))
                .where(matchesUser)
        ),
        inArray(
            resourceSessions.accessTokenId,
            db
                .select({ accessTokenId: resourceAccessToken.accessTokenId })
                .from(resourceAccessToken)
                .leftJoin(users, eq(users.userId, resourceAccessToken.userId))
                .where(
                    or(
                        like(sql`LOWER(${resourceAccessToken.title})`, term),
                        matchesUser
                    )
                )
        ),
        inArray(
            resourceSessions.whitelistId,
            db
                .select({ whitelistId: resourceWhitelist.whitelistId })
                .from(resourceWhitelist)
                .where(like(sql`LOWER(${resourceWhitelist.email})`, term))
        ),
        inArray(
            resourceSessions.policyWhitelistId,
            db
                .select({ whitelistId: resourcePolicyWhiteList.whitelistId })
                .from(resourcePolicyWhiteList)
                .where(like(sql`LOWER(${resourcePolicyWhiteList.email})`, term))
        )
    )!;
}

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

        const parsedQuery = listSchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error).toString()
                )
            );
        }
        const {
            pageSize,
            page,
            query,
            sort_by,
            order,
            resourceId,
            userId,
            authMethod,
            sessionId
        } = parsedQuery.data;

        // Request tokens are short-lived exchange tokens, not usable sessions,
        // and expired rows are only cleaned up lazily, so hide both.
        const conditions: SQL[] = [
            eq(resources.orgId, orgId),
            gt(resourceSessions.expiresAt, Date.now()),
            or(
                isNull(resourceSessions.isRequestToken),
                eq(resourceSessions.isRequestToken, false)
            )!
        ];

        if (typeof resourceId !== "undefined") {
            conditions.push(eq(resourceSessions.resourceId, resourceId));
        }

        if (typeof userId !== "undefined") {
            conditions.push(userCondition(userId));
        }

        if (typeof authMethod !== "undefined") {
            conditions.push(authMethodCondition(authMethod));
        }

        if (typeof sessionId !== "undefined") {
            conditions.push(
                or(
                    eq(resourceSessions.sessionId, sessionId),
                    eq(resourceSessions.requestSessionId, sessionId)
                )!
            );
        }

        if (query) {
            conditions.push(searchCondition(query));
        }

        const whereClause = and(...conditions);

        const sortColumn =
            sort_by === "expiresAt"
                ? resourceSessions.expiresAt
                : resourceSessions.issuedAt;
        const orderBy = [
            order === "asc" ? asc(sortColumn) : desc(sortColumn),
            desc(resourceSessions.sessionId)
        ];

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
                .orderBy(...orderBy)
                .limit(pageSize)
                .offset(pageSize * (page - 1)),
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
                    pageSize,
                    page
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
