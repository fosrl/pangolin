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
    LoginPageBranding,
    loginPageBranding,
    loginPageBrandingOrg
} from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { eq } from "drizzle-orm";

const paramsSchema = z.strictObject({
    orgId: z.string()
});

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/login-page-branding",
    description: "Get the login page branding for an organization.",
    tags: [OpenAPITags.Org],
    request: {
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
