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
import { db, idpOrg } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { and, eq } from "drizzle-orm";
import { OpenAPITags, registry } from "@server/openApi";
import { loadApiProvider } from "#private/lib/idpAPI/loadApiProvider";
import { idpApiDraftSchema } from "#private/lib/idpAPI/draft";
import type { IdpApiTestResult } from "#private/lib/idpAPI/types";

const paramsSchema = z
    .object({
        orgId: z.string().nonempty(),
        idpId: z.coerce.number<number>().int().positive()
    })
    .strict();

const bodySchema = z.strictObject({
    /** Unsaved form values to test instead of the saved settings. */
    draft: idpApiDraftSchema.optional()
});

export type TestOrgIdpApiIntegrationResponse = IdpApiTestResult;

registry.registerPath({
    method: "post",
    path: "/org/{orgId}/idp/{idpId}/api-integration/test",
    description:
        "Test the API integration credentials (the saved ones, or the unsaved `draft`) of an organization IdP: gets a fresh access token, then reads one user and one group from the directory.",
    tags: [OpenAPITags.OrgIdp],
    request: {
        params: paramsSchema,
        body: {
            content: {
                "application/json": {
                    schema: bodySchema
                }
            }
        }
    },
    responses: {}
});

export async function testOrgIdpApiIntegration(
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

        const parsedBody = bodySchema.safeParse(req.body ?? {});
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }
        const { draft } = parsedBody.data;

        const { orgId, idpId } = parsedParams.data;

        const [association] = await db
            .select({ idpId: idpOrg.idpId })
            .from(idpOrg)
            .where(and(eq(idpOrg.idpId, idpId), eq(idpOrg.orgId, orgId)))
            .limit(1);
        if (!association) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `IdP with ID ${idpId} is not associated with organization ${orgId}`
                )
            );
        }

        const provider = await loadApiProvider(idpId, draft);
        if (provider instanceof Error) {
            return next(provider);
        }

        const result = await provider.testConnection();

        return response<TestOrgIdpApiIntegrationResponse>(res, {
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
