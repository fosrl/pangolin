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
import { db, loginPageBranding, loginPageBrandingOrg, orgs } from "@server/db";
import { eq, and } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import type { LoadLoginPageBrandingResponse } from "@server/routers/loginPage/types";

const querySchema = z.object({
    orgId: z.string().min(1)
});

async function query(orgId: string) {
    const [orgLink] = await db
        .select()
        .from(loginPageBrandingOrg)
        .where(eq(loginPageBrandingOrg.orgId, orgId))
        .innerJoin(orgs, eq(loginPageBrandingOrg.orgId, orgs.orgId));
    if (!orgLink) {
        return null;
    }

    const [res] = await db
        .select()
        .from(loginPageBranding)
        .where(
            and(
                eq(
                    loginPageBranding.loginPageBrandingId,
                    orgLink.loginPageBrandingOrg.loginPageBrandingId
                )
            )
        )
        .limit(1);
    return {
        ...res,
        orgId: orgLink.orgs.orgId,
        orgName: orgLink.orgs.name
    };
}

export async function loadLoginPageBranding(
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

        const { orgId } = parsedQuery.data;

        const branding = await query(orgId);

        if (!branding) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "Branding for Login page not found"
                )
            );
        }

        return response<LoadLoginPageBrandingResponse>(res, {
            data: branding,
            success: true,
            error: false,
            message: "Login page branding retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
