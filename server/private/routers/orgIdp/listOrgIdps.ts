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
import { db, idpOidcConfig } from "@server/db";
import { idp, idpOrg, orgs } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { ListOrgIdpsResponse } from "@server/routers/orgIdp/types";

const querySchema = z.strictObject({
    limit: z
        .string()
        .optional()
        .default("1000")
        .transform(Number)
        .pipe(z.int().nonnegative()),
    offset: z
        .string()
        .optional()
        .default("0")
        .transform(Number)
        .pipe(z.int().nonnegative())
});

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty()
});

async function query(orgId: string, limit: number, offset: number) {
    const res = await db
        .select({
            idpId: idp.idpId,
            orgId: idpOrg.orgId,
            name: idp.name,
            type: idp.type,
            variant: idpOidcConfig.variant,
            tags: idp.tags
        })
        .from(idpOrg)
        .where(eq(idpOrg.orgId, orgId))
        .innerJoin(idp, eq(idp.idpId, idpOrg.idpId))
        .innerJoin(idpOidcConfig, eq(idpOidcConfig.idpId, idpOrg.idpId))
        .orderBy(sql`idp.name DESC`)
        .limit(limit)
        .offset(offset);

    // The other orgs each IdP is shared with, so the dashboard can offer
    // unassociate (shared) or delete (last org), and say which orgs still
    // use it.
    const idpIds = res.map((r) => r.idpId);
    const otherLinks =
        idpIds.length > 0
            ? await db
                  .select({
                      idpId: idpOrg.idpId,
                      orgId: orgs.orgId,
                      orgName: orgs.name
                  })
                  .from(idpOrg)
                  .innerJoin(orgs, eq(orgs.orgId, idpOrg.orgId))
                  .where(
                      and(
                          inArray(idpOrg.idpId, idpIds),
                          ne(idpOrg.orgId, orgId)
                      )
                  )
                  .orderBy(orgs.name)
            : [];
    const othersById = new Map<number, { orgId: string; orgName: string }[]>();
    for (const link of otherLinks) {
        const list = othersById.get(link.idpId) ?? [];
        list.push({ orgId: link.orgId, orgName: link.orgName });
        othersById.set(link.idpId, list);
    }

    return res.map((r) => {
        const sharedWithOrgs = othersById.get(r.idpId) ?? [];
        return {
            ...r,
            orgCount: sharedWithOrgs.length + 1,
            sharedWithOrgs
        };
    });
}

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/idp",
    description: "List all IDP for a specific organization.",
    tags: [OpenAPITags.OrgIdp],
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

export async function listOrgIdps(
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
        const { limit, offset } = parsedQuery.data;

        const list = await query(orgId, limit, offset);

        const [{ count }] = await db
            .select({ count: sql<number>`count(*)` })
            .from(idp);

        return response<ListOrgIdpsResponse>(res, {
            data: {
                idps: list,
                pagination: {
                    total: count,
                    limit,
                    offset
                }
            },
            success: true,
            error: false,
            message: "Org Idps retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
