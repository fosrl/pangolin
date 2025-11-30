/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025 Fossorial, Inc.
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
import { eq, and } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { LoadLoginPageResponse } from "@server/routers/loginPage/types";

const querySchema = z.object({
    resourceId: z.coerce.number().int().positive().optional(),
    idpId: z.coerce.number().int().positive().optional(),
    orgId: z.string().min(1).optional(),
    fullDomain: z.string().min(1)
});

async function query(orgId: string | undefined, fullDomain: string) {
    if (!orgId) {
        const [res] = await db
            .select()
            .from(loginPage)
            .where(eq(loginPage.fullDomain, fullDomain))
            .innerJoin(
                loginPageOrg,
                eq(loginPage.loginPageId, loginPageOrg.loginPageId)
            )
            .limit(1);
        return {
            ...res.loginPage,
            orgId: res.loginPageOrg.orgId
        };
    }

    const [orgLink] = await db
        .select()
        .from(loginPageOrg)
        .where(eq(loginPageOrg.orgId, orgId));

    if (!orgLink) {
        return null;
    }

    const [res] = await db
        .select()
        .from(loginPage)
        .where(
            and(
                eq(loginPage.loginPageId, orgLink.loginPageId),
                eq(loginPage.fullDomain, fullDomain)
            )
        )
        .limit(1);
    return {
        ...res,
        orgId: orgLink.orgId
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

        const { resourceId, idpId, fullDomain } = parsedQuery.data;

        let orgId: string | undefined = undefined;
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

            orgId = resource.orgId;
        } else if (idpId) {
            const [idpOrgLink] = await db
                .select()
                .from(idpOrg)
                .where(eq(idpOrg.idpId, idpId));

            if (!idpOrgLink) {
                return next(
                    createHttpError(HttpCode.NOT_FOUND, "IdP not found")
                );
            }

            orgId = idpOrgLink.orgId;
        } else if (parsedQuery.data.orgId) {
            orgId = parsedQuery.data.orgId;
        }

        const loginPage = await query(orgId, fullDomain);

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
