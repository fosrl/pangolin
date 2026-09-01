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
    exitNodes,
    loginPage,
    LoginPage,
    loginPageOrg,
    resources,
    sites
} from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { eq, and } from "drizzle-orm";
import { validateAndConstructDomain } from "@server/lib/domainUtils";
import { createCertificate } from "@server/routers/certificates/createCertificate";

import { CreateLoginPageResponse } from "@server/routers/loginPage/types";

const paramsSchema = z.strictObject({
    orgId: z.string()
});

const bodySchema = z.strictObject({
    subdomain: z.string().nullable().optional(),
    domainId: z.string()
});

export type CreateLoginPageBody = z.infer<typeof bodySchema>;

export async function createLoginPage(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { domainId, subdomain } = parsedBody.data;

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

        const [existing] = await db
            .select()
            .from(loginPageOrg)
            .where(eq(loginPageOrg.orgId, orgId));

        if (existing) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "A login page already exists for this organization"
                )
            );
        }

        const domainResult = await validateAndConstructDomain(
            domainId,
            orgId,
            subdomain
        );

        if (!domainResult.success) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, domainResult.error)
            );
        }

        const { fullDomain, subdomain: finalSubdomain } = domainResult;

        logger.debug(`Full domain: ${fullDomain}`);

        const existingResource = await db
            .select()
            .from(resources)
            .where(eq(resources.fullDomain, fullDomain));

        if (existingResource.length > 0) {
            return next(
                createHttpError(
                    HttpCode.CONFLICT,
                    "Resource with that domain already exists"
                )
            );
        }

        const existingLoginPages = await db
            .select()
            .from(loginPage)
            .where(eq(loginPage.fullDomain, fullDomain));

        if (existingLoginPages.length > 0) {
            return next(
                createHttpError(
                    HttpCode.CONFLICT,
                    "Login page with that domain already exists"
                )
            );
        }

        let returned: LoginPage | undefined;
        await db.transaction(async (trx) => {
            const orgSites = await trx
                .select()
                .from(sites)
                .innerJoin(
                    exitNodes,
                    eq(exitNodes.exitNodeId, sites.exitNodeId)
                )
                .where(
                    and(
                        eq(sites.orgId, orgId),
                        eq(exitNodes.type, "gerbil"),
                        eq(exitNodes.online, true)
                    )
                )
                .limit(10);

            let exitNodesList = orgSites.map((s) => s.exitNodes);

            if (exitNodesList.length === 0) {
                exitNodesList = await trx
                    .select()
                    .from(exitNodes)
                    .where(
                        and(
                            eq(exitNodes.type, "gerbil"),
                            eq(exitNodes.online, true)
                        )
                    )
                    .limit(10);
            }

            // select a random exit node
            const randomExitNode =
                exitNodesList[Math.floor(Math.random() * exitNodesList.length)];

            if (!randomExitNode) {
                throw new Error("No exit nodes available");
            }

            const [returnedLoginPage] = await db
                .insert(loginPage)
                .values({
                    subdomain: finalSubdomain,
                    fullDomain,
                    domainId,
                    exitNodeId: randomExitNode.exitNodeId
                })
                .returning();

            await trx.insert(loginPageOrg).values({
                orgId,
                loginPageId: returnedLoginPage.loginPageId
            });

            returned = returnedLoginPage;
        });

        if (!returned) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Failed to create login page"
                )
            );
        }

        await createCertificate(domainId, fullDomain, db);

        return response<LoginPage>(res, {
            data: returned,
            success: true,
            error: false,
            message: "Login page created successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
