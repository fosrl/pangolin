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

import {
    db,
    resourcePolicies,
    resources,
    rolePolicies,
    userPolicies
} from "@server/db";
import response from "@server/lib/response";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";
import type {
    ListResourcePoliciesResponse,
    ResourcePolicyWithResources
} from "@server/routers/resource/types";
import HttpCode from "@server/types/HttpCode";
import { and, asc, eq, inArray, like, or, sql } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";

const listResourcePoliciesParamsSchema = z.strictObject({
    orgId: z.string()
});

const listResourcePoliciesSchema = z.object({
    pageSize: z.coerce
        .number<string>() // for prettier formatting
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
        .number<string>() // for prettier formatting
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
    query: z.string().optional()
});

function queryResourcePoliciesBase() {
    return db
        .select({
            resourcePolicyId: resourcePolicies.resourcePolicyId,
            name: resourcePolicies.name,
            niceId: resourcePolicies.niceId,
            orgId: resourcePolicies.orgId
        })
        .from(resourcePolicies);
}

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/resource-policies",
    description: "List resource policies for an organization.",
    tags: [OpenAPITags.PublicResourcePolicy],
    request: {
        params: z.object({
            orgId: z.string()
        }),
        query: listResourcePoliciesSchema
    },
    responses: {}
});

export async function listResourcePolicies(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = listResourcePoliciesSchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsedQuery.error)
                )
            );
        }
        const { page, pageSize, query } = parsedQuery.data;

        const parsedParams = listResourcePoliciesParamsSchema.safeParse(
            req.params
        );
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsedParams.error)
                )
            );
        }

        const orgId =
            parsedParams.data.orgId ||
            req.userOrg?.orgId ||
            req.apiKeyOrg?.orgId;

        if (!orgId) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid organization ID")
            );
        }

        if (req.user && orgId && orgId !== req.userOrgId) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not have access to this organization"
                )
            );
        }

        let accessibleResourcePolicies: Array<{ resourcePolicyId: number }>;
        if (req.user) {
            accessibleResourcePolicies = await db
                .select({
                    resourcePolicyId: sql<number>`COALESCE(${userPolicies.resourcePolicyId}, ${rolePolicies.resourcePolicyId})`
                })
                .from(userPolicies)
                .fullJoin(
                    rolePolicies,
                    eq(
                        userPolicies.resourcePolicyId,
                        rolePolicies.resourcePolicyId
                    )
                )
                .where(
                    or(
                        eq(userPolicies.userId, req.user!.userId),
                        inArray(rolePolicies.roleId, req.userOrgRoleIds || [])
                    )
                );
        } else {
            accessibleResourcePolicies = await db
                .select({
                    resourcePolicyId: resourcePolicies.resourcePolicyId
                })
                .from(resourcePolicies)
                .where(eq(resourcePolicies.orgId, orgId));
        }

        const accessibleResourceIds = accessibleResourcePolicies.map(
            (resource) => resource.resourcePolicyId
        );

        const conditions = [
            and(
                inArray(
                    resourcePolicies.resourcePolicyId,
                    accessibleResourceIds
                ),
                eq(resourcePolicies.orgId, orgId),
                eq(resourcePolicies.scope, "global")
            )
        ];

        if (query) {
            conditions.push(
                or(
                    like(
                        sql`LOWER(${resourcePolicies.name})`,
                        "%" + query.toLowerCase() + "%"
                    ),
                    like(
                        sql`LOWER(${resourcePolicies.niceId})`,
                        "%" + query.toLowerCase() + "%"
                    )
                )
            );
        }

        const baseQuery = queryResourcePoliciesBase().where(and(...conditions));

        // we need to add `as` so that drizzle filters the result as a subquery
        const countQuery = db.$count(baseQuery.as("filtered_policies"));

        const [rows, totalCount] = await Promise.all([
            baseQuery
                .limit(pageSize)
                .offset(pageSize * (page - 1))
                .orderBy(asc(resourcePolicies.resourcePolicyId)),
            countQuery
        ]);

        const attachedResources =
            rows.length === 0
                ? []
                : await db
                      .select({
                          resourceId: resources.resourceId,
                          niceId: resources.niceId,
                          name: resources.name,
                          fullDomain: resources.fullDomain,
                          resourcePolicyId: resources.resourcePolicyId
                      })
                      .from(resources)
                      .where(
                          inArray(
                              resources.resourcePolicyId,
                              rows.map((row) => row.resourcePolicyId)
                          )
                      );

        // avoids TS issues with reduce/never[]
        const map = new Map<number, ResourcePolicyWithResources>();

        for (const row of rows) {
            let entry = map.get(row.resourcePolicyId);
            if (!entry) {
                entry = {
                    ...row,
                    resources: []
                };
                map.set(row.resourcePolicyId, entry);
            }

            entry.resources = attachedResources.filter(
                (r) => r.resourcePolicyId === entry?.resourcePolicyId
            );
        }

        const policiesList = Array.from(map.values());

        return response<ListResourcePoliciesResponse>(res, {
            data: {
                policies: policiesList,
                pagination: {
                    total: totalCount,
                    pageSize,
                    page
                }
            },
            success: true,
            error: false,
            message: "Resources retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
