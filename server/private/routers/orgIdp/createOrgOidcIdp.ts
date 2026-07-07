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
import { db } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { idp, idpOidcConfig, idpOrg, orgs } from "@server/db";
import { generateOidcRedirectUrl } from "@server/lib/idp/generateRedirectUrl";
import { encrypt } from "@server/lib/crypto";
import config from "@server/lib/config";
import { CreateOrgIdpResponse } from "@server/routers/orgIdp/types";
import { isSubscribed } from "#private/lib/isSubscribed";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { build } from "@server/build";

const paramsSchema = z.strictObject({ orgId: z.string().nonempty() });

const bodySchema = z.strictObject({
    name: z.string().nonempty(),
    clientId: z.string().nonempty(),
    clientSecret: z.string().nonempty(),
    authUrl: z.url(),
    tokenUrl: z.url(),
    identifierPath: z.string().nonempty(),
    emailPath: z.string().optional(),
    namePath: z.string().optional(),
    scopes: z.string().nonempty(),
    autoProvision: z.boolean().optional(),
    variant: z.enum(["oidc", "google", "azure"]).optional().default("oidc"),
    roleMapping: z.string().optional(),
    orgMapping: z.string().nullish(),
    tags: z.string().optional()
});

registry.registerPath({
    method: "put",
    path: "/org/{orgId}/idp/oidc",
    description: "Create an OIDC IdP for a specific organization.",
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

export async function createOrgOidcIdp(
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

        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const {
            clientId,
            clientSecret,
            authUrl,
            tokenUrl,
            scopes,
            identifierPath,
            emailPath,
            namePath,
            name,
            variant,
            roleMapping,
            orgMapping: orgMappingBody,
            tags
        } = parsedBody.data;

        let { autoProvision } = parsedBody.data;

        if (build == "saas") {
            // this is not paywalled with a ee license because this whole endpoint is restricted
            const subscribed = await isSubscribed(
                orgId,
                tierMatrix.deviceApprovals
            );
            if (!subscribed) {
                autoProvision = false;
            }
        }

        const key = config.getRawConfig().server.secret!;

        const encryptedSecret = encrypt(clientSecret, key);
        const encryptedClientId = encrypt(clientId, key);

        let idpId: number | undefined;
        await db.transaction(async (trx) => {
            const [idpRes] = await trx
                .insert(idp)
                .values({
                    name,
                    autoProvision,
                    type: "oidc",
                    tags
                })
                .returning();

            idpId = idpRes.idpId;

            await trx.insert(idpOidcConfig).values({
                idpId: idpRes.idpId,
                clientId: encryptedClientId,
                clientSecret: encryptedSecret,
                authUrl,
                tokenUrl,
                scopes,
                identifierPath,
                emailPath,
                namePath,
                variant
            });

            await trx.insert(idpOrg).values({
                idpId: idpRes.idpId,
                orgId: orgId,
                roleMapping: roleMapping || null,
                orgMapping: orgMappingBody
            });
        });

        const redirectUrl = await generateOidcRedirectUrl(
            idpId as number,
            orgId
        );

        return response<CreateOrgIdpResponse>(res, {
            data: {
                idpId: idpId as number,
                redirectUrl
            },
            success: true,
            error: false,
            message: "Org Idp created successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
