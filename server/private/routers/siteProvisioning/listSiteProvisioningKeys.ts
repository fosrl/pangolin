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

import { db, siteProvisioningKeyOrg, siteProvisioningKeys } from "@server/db";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import response from "@server/lib/response";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { eq } from "drizzle-orm";
import type { ListSiteProvisioningKeysResponse } from "@server/routers/siteProvisioning/types";
import { createApiResponseSchema } from "@server/lib/openapi/createApiResponseSchema";
import { OpenAPITags, registry } from "@server/openApi";

const paramsSchema = z.object({
    orgId: z.string().nonempty()
});

const querySchema = z.object({
    limit: z
        .string()
        .optional()
        .default("1000")
        .transform(Number)
        .pipe(z.int().positive()),
    offset: z
        .string()
        .optional()
        .default("0")
        .transform(Number)
        .pipe(z.int().nonnegative())
});

const ListSiteProvisioningKeysResponseDataSchema = z.object({
    siteProvisioningKeys: z.array(
        z.object({
            siteProvisioningKeyId: z.string(),
            orgId: z.string(),
            lastChars: z.string(),
            createdAt: z.string(),
            name: z.string(),
            lastUsed: z.string().nullable(),
            maxBatchSize: z.number().nullable(),
            numUsed: z.number(),
            validUntil: z.string().nullable(),
            approveNewSites: z.boolean()
        })
    ),
    pagination: z.object({
        total: z.number(),
        limit: z.number(),
        offset: z.number()
    })
});

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/site-provisioning-keys",
    description: "List all site provisioning keys for an organization.",
    tags: [OpenAPITags.SiteProvisioningKey],
    request: {
        params: paramsSchema,
        query: querySchema
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: createApiResponseSchema(
                        ListSiteProvisioningKeysResponseDataSchema
                    )
                }
            }
        }
    }
});

function querySiteProvisioningKeys(orgId: string) {
    return db
        .select({
            siteProvisioningKeyId: siteProvisioningKeys.siteProvisioningKeyId,
            orgId: siteProvisioningKeyOrg.orgId,
            lastChars: siteProvisioningKeys.lastChars,
            createdAt: siteProvisioningKeys.createdAt,
            name: siteProvisioningKeys.name,
            lastUsed: siteProvisioningKeys.lastUsed,
            maxBatchSize: siteProvisioningKeys.maxBatchSize,
            numUsed: siteProvisioningKeys.numUsed,
            validUntil: siteProvisioningKeys.validUntil,
            approveNewSites: siteProvisioningKeys.approveNewSites
        })
        .from(siteProvisioningKeyOrg)
        .innerJoin(
            siteProvisioningKeys,
            eq(
                siteProvisioningKeys.siteProvisioningKeyId,
                siteProvisioningKeyOrg.siteProvisioningKeyId
            )
        )
        .where(eq(siteProvisioningKeyOrg.orgId, orgId));
}

export async function listSiteProvisioningKeys(
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
                    fromError(parsedParams.error)
                )
            );
        }

        const parsedQuery = querySchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error)
                )
            );
        }

        const { orgId } = parsedParams.data;
        const { limit, offset } = parsedQuery.data;

        const siteProvisioningKeysList = await querySiteProvisioningKeys(orgId)
            .limit(limit)
            .offset(offset);

        return response<ListSiteProvisioningKeysResponse>(res, {
            data: {
                siteProvisioningKeys: siteProvisioningKeysList,
                pagination: {
                    total: siteProvisioningKeysList.length,
                    limit,
                    offset
                }
            },
            success: true,
            error: false,
            message: "Site provisioning keys retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
