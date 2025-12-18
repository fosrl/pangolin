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
import {
    db,
    LoginPageBranding,
    loginPageBranding,
    loginPageBrandingOrg
} from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { eq } from "drizzle-orm";
import { getOrgTierData } from "#private/lib/billing";
import { TierId } from "@server/lib/billing/tiers";
import { build } from "@server/build";

const paramsSchema = z
    .object({
        orgId: z.string()
    })
    .strict();

export async function getLoginPageBranding(
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

        if (build === "saas") {
            const { tier } = await getOrgTierData(orgId);
            const subscribed = tier === TierId.STANDARD;
            if (!subscribed) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "This organization's current plan does not support this feature."
                    )
                );
            }
        }

        const [existingLoginPageBranding] = await db
            .select()
            .from(loginPageBranding)
            .innerJoin(
                loginPageBrandingOrg,
                eq(
                    loginPageBrandingOrg.loginPageBrandingId,
                    loginPageBranding.loginPageBrandingId
                )
            )
            .where(eq(loginPageBrandingOrg.orgId, orgId));

        if (!existingLoginPageBranding) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "Login page branding not found"
                )
            );
        }

        return response<LoginPageBranding>(res, {
            data: existingLoginPageBranding.loginPageBranding,
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
