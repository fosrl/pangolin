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
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { isOrgIdentityProviderMode } from "@server/lib/idp/idpExistsForOrg";
import { loadEnabledApiProvider } from "#private/lib/idpAPI/loadApiProvider";
import type { IdpApiTestResult } from "#private/lib/idpAPI/types";

const paramsSchema = z
    .object({
        idpId: z.coerce.number<number>().int().positive()
    })
    .strict();

export type TestIdpApiIntegrationResponse = IdpApiTestResult;

registry.registerPath({
    method: "post",
    path: "/idp/{idpId}/api-integration/test",
    description:
        "Test the saved API integration credentials of a global IdP: gets a fresh access token, then reads one user and one group from the directory.",
    tags: [OpenAPITags.GlobalIdp],
    request: {
        params: paramsSchema
    },
    responses: {}
});

export async function testIdpApiIntegration(
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

        if (isOrgIdentityProviderMode()) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Global IdPs are not available in the current identity provider mode, use the organization endpoint instead"
                )
            );
        }

        const provider = await loadEnabledApiProvider(parsedParams.data.idpId);
        if (provider instanceof Error) {
            return next(provider);
        }

        const result = await provider.testConnection();

        return response<TestIdpApiIntegrationResponse>(res, {
            data: result,
            success: true,
            error: false,
            message: result.ok
                ? "API integration works"
                : "API integration test failed",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
