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
import { db, idpOrg, loginPage, loginPageOrg } from "@server/db";
import { idp, idpOidcConfig } from "@server/db";
import { eq, and } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import config from "@server/lib/config";
import { decrypt } from "@server/lib/crypto";
import { generateOidcRedirectUrl } from "@server/lib/idp/generateRedirectUrl";
import { GetOrgIdpResponse } from "@server/routers/orgIdp/types";

const paramsSchema = z
    .object({
        orgId: z.string().nonempty(),
        idpId: z.coerce.number<number>()
    })
    .strict();

async function query(idpId: number, orgId: string) {
    const [res] = await db
        .select()
        .from(idp)
        .where(eq(idp.idpId, idpId))
        .leftJoin(idpOidcConfig, eq(idpOidcConfig.idpId, idp.idpId))
        .leftJoin(
            idpOrg,
            and(eq(idpOrg.idpId, idp.idpId), eq(idpOrg.orgId, orgId))
        )
        .limit(1);
    return res;
}

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/idp/{idpId}",
    description: "Get an IDP by its IDP ID for a specific organization.",
    tags: [OpenAPITags.OrgIdp],
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

export async function getOrgIdp(
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

        const { idpId, orgId } = parsedParams.data;

        const idpRes = await query(idpId, orgId);

        if (!idpRes) {
            return next(createHttpError(HttpCode.NOT_FOUND, "Idp not found"));
        }

        const key = config.getRawConfig().server.secret!;

        if (idpRes.idp.type === "oidc") {
            const clientSecret = idpRes.idpOidcConfig!.clientSecret;
            const clientId = idpRes.idpOidcConfig!.clientId;

            idpRes.idpOidcConfig!.clientSecret = decrypt(clientSecret, key);
            idpRes.idpOidcConfig!.clientId = decrypt(clientId, key);
        }

        const redirectUrl = await generateOidcRedirectUrl(
            idpRes.idp.idpId,
            orgId
        );

        return response<GetOrgIdpResponse>(res, {
            data: {
                ...idpRes,
                redirectUrl
            },
            success: true,
            error: false,
            message: "Org Idp retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
