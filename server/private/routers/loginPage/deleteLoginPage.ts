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
import { db, loginPage, LoginPage, loginPageOrg } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { eq, and } from "drizzle-orm";
import { DeleteLoginPageResponse } from "@server/routers/loginPage/types";
import {
    exitNodeScopeOf,
    notifyTraefikConfigChanged
} from "@server/lib/traefik/configUpdates";

const paramsSchema = z
    .object({
        orgId: z.string(),
        loginPageId: z.coerce.number<number>()
    })
    .strict();

export async function deleteLoginPage(
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

        const [existingLoginPage] = await db
            .select()
            .from(loginPage)
            .where(eq(loginPage.loginPageId, parsedParams.data.loginPageId))
            .innerJoin(
                loginPageOrg,
                eq(loginPageOrg.orgId, parsedParams.data.orgId)
            );

        if (!existingLoginPage) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Login page not found")
            );
        }

        await db
            .delete(loginPageOrg)
            .where(
                and(
                    eq(loginPageOrg.orgId, parsedParams.data.orgId),
                    eq(loginPageOrg.loginPageId, parsedParams.data.loginPageId)
                )
            );

        // const leftoverLinks = await db
        //     .select()
        //     .from(loginPageOrg)
        //     .where(eq(loginPageOrg.loginPageId, parsedParams.data.loginPageId))
        //     .limit(1);

        // if (!leftoverLinks.length) {
        await db
            .delete(loginPage)
            .where(eq(loginPage.loginPageId, parsedParams.data.loginPageId));

        await db
            .delete(loginPageOrg)
            .where(eq(loginPageOrg.loginPageId, parsedParams.data.loginPageId));
        // }

        notifyTraefikConfigChanged(
            exitNodeScopeOf(existingLoginPage.loginPage.exitNodeId),
            `login page ${existingLoginPage.loginPage.loginPageId} deleted`
        );

        return response<LoginPage>(res, {
            data: existingLoginPage.loginPage,
            success: true,
            error: false,
            message: "Login page deleted successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
