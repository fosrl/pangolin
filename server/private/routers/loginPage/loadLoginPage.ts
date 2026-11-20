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
import { db, idpOrg, loginPage, loginPageOrg, resources } from "@server/db";
import { eq, and, inArray } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { LoadLoginPageResponse } from "@server/routers/loginPage/types";

const querySchema = z
    .object({
        resourceId: z.coerce.number<number>().int().positive().optional(),
        idpId: z.coerce.number<number>().int().positive().optional(),
        orgId: z.string().min(1).optional(),
        fullDomain: z.string().min(1).optional()
    })
    .refine((data) => Boolean(data.fullDomain || data.orgId), {
        error: "orgId or fullDomain is required"
    });

// A Host header can carry a port (e.g. "login.example.com:443"); login pages
// are stored by bare domain.
function stripPort(host: string): string {
    return host.replace(/:\d{1,5}$/, "");
}

// orgIds holds every org the caller may belong to: one for a resource or an
// explicit orgId, but all linked orgs for an IdP, since one IdP can be
// imported into several orgs.
async function query(
    orgIds: string[] | undefined,
    fullDomain: string | undefined
) {
    if (orgIds && orgIds.length === 0) {
        return null;
    }

    if (orgIds && !fullDomain) {
        const [res] = await db
            .select()
            .from(loginPageOrg)
            .where(inArray(loginPageOrg.orgId, orgIds))
            .innerJoin(
                loginPage,
                eq(loginPage.loginPageId, loginPageOrg.loginPageId)
            )
            .limit(1);

        if (!res) {
            return null;
        }

        return {
            ...res.loginPage,
            orgId: res.loginPageOrg.orgId
        };
    }

    if (!fullDomain) {
        return null;
    }

    const [res] = await db
        .select()
        .from(loginPage)
        .innerJoin(
            loginPageOrg,
            eq(loginPage.loginPageId, loginPageOrg.loginPageId)
        )
        .where(
            and(
                eq(loginPage.fullDomain, fullDomain),
                orgIds ? inArray(loginPageOrg.orgId, orgIds) : undefined
            )
        )
        .limit(1);

    if (!res) {
        return null;
    }

    return {
        ...res.loginPage,
        orgId: res.loginPageOrg.orgId
    };
}

export async function loadLoginPage(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = querySchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error).toString()
                )
            );
        }

        const { resourceId, idpId } = parsedQuery.data;
        const fullDomain = parsedQuery.data.fullDomain
            ? stripPort(parsedQuery.data.fullDomain)
            : undefined;

        let orgIds: string[] | undefined = undefined;
        if (resourceId) {
            const [resource] = await db
                .select()
                .from(resources)
                .where(eq(resources.resourceId, resourceId))
                .limit(1);

            if (!resource) {
                return next(
                    createHttpError(HttpCode.NOT_FOUND, "Resource not found")
                );
            }

            orgIds = [resource.orgId];
        } else if (idpId) {
            const idpOrgLinks = await db
                .select({ orgId: idpOrg.orgId })
                .from(idpOrg)
                .where(eq(idpOrg.idpId, idpId));

            if (idpOrgLinks.length === 0) {
                return next(
                    createHttpError(HttpCode.NOT_FOUND, "IdP not found")
                );
            }

            orgIds = idpOrgLinks.map((link) => link.orgId);
        } else if (parsedQuery.data.orgId) {
            orgIds = [parsedQuery.data.orgId];
        }

        const loginPage = await query(orgIds, fullDomain);

        if (!loginPage) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Login page not found")
            );
        }

        return response<LoadLoginPageResponse>(res, {
            data: loginPage,
            success: true,
            error: false,
            message: "Login page retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
