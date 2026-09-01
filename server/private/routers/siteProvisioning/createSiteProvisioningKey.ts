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

import { NextFunction, Request, Response } from "express";
import { db, siteProvisioningKeyOrg, siteProvisioningKeys } from "@server/db";
import HttpCode from "@server/types/HttpCode";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import createHttpError from "http-errors";
import response from "@server/lib/response";
import moment from "moment";
import {
    generateId,
    generateIdFromEntropySize
} from "@server/auth/sessions/app";
import logger from "@server/logger";
import { hashPassword } from "@server/auth/password";
import type { CreateSiteProvisioningKeyResponse } from "@server/routers/siteProvisioning/types";
import { createApiResponseSchema } from "@server/lib/openapi/createApiResponseSchema";
import { OpenAPITags, registry } from "@server/openApi";

const paramsSchema = z.object({
    orgId: z.string().nonempty()
});

const bodySchema = z
    .strictObject({
        name: z.string().min(1).max(255),
        maxBatchSize: z
            .union([
                z.null(),
                z.coerce.number().int().positive().max(1_000_000)
            ])
            .openapi({
                type: "number",
                default: null,
                description:
                    "Maximum number of sites that can be provisioned in a single batch. If null, there is no limit."
            }),
        validUntil: z.string().max(255).optional(),
        approveNewSites: z.boolean().optional().default(true)
    })
    .superRefine((data, ctx) => {
        const v = data.validUntil;
        if (v == null || v.trim() === "") {
            return;
        }
        if (Number.isNaN(Date.parse(v))) {
            ctx.addIssue({
                code: "custom",
                message: "Invalid validUntil",
                path: ["validUntil"]
            });
        }
    });

export type CreateSiteProvisioningKeyBody = z.infer<typeof bodySchema>;

const CreateSiteProvisioningKeyResponseDataSchema = z.object({
    siteProvisioningKeyId: z.string(),
    orgId: z.string(),
    name: z.string(),
    siteProvisioningKey: z.string(),
    lastChars: z.string(),
    createdAt: z.string(),
    lastUsed: z.string().nullable(),
    maxBatchSize: z.number().nullable(),
    numUsed: z.number(),
    validUntil: z.string().nullable(),
    approveNewSites: z.boolean()
});

registry.registerPath({
    method: "put",
    path: "/org/{orgId}/site-provisioning-key",
    description: "Create a new site provisioning key for the organization.",
    tags: [OpenAPITags.SiteProvisioningKey],
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
        201: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: createApiResponseSchema(
                        CreateSiteProvisioningKeyResponseDataSchema
                    )
                }
            }
        }
    }
});

export async function createSiteProvisioningKey(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const parsedParams = paramsSchema.safeParse(req.params);
    if (!parsedParams.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedParams.error).toString()
            )
        );
    }

    const parsedBody = bodySchema.safeParse(req.body);
    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    const { orgId } = parsedParams.data;
    const { name, maxBatchSize, approveNewSites } = parsedBody.data;
    const vuRaw = parsedBody.data.validUntil;
    const validUntil =
        vuRaw == null || vuRaw.trim() === ""
            ? null
            : new Date(Date.parse(vuRaw)).toISOString();

    const siteProvisioningKeyId = `spk-${generateId(15)}`;
    const siteProvisioningKey = generateIdFromEntropySize(25);
    const siteProvisioningKeyHash = await hashPassword(siteProvisioningKey);
    const lastChars = siteProvisioningKey.slice(-4);
    const createdAt = moment().toISOString();
    const provisioningKey = `${siteProvisioningKeyId}.${siteProvisioningKey}`;

    await db.transaction(async (trx) => {
        await trx.insert(siteProvisioningKeys).values({
            siteProvisioningKeyId,
            name,
            siteProvisioningKeyHash,
            createdAt,
            lastChars,
            lastUsed: null,
            maxBatchSize,
            numUsed: 0,
            validUntil,
            approveNewSites
        });

        await trx.insert(siteProvisioningKeyOrg).values({
            siteProvisioningKeyId,
            orgId
        });
    });

    try {
        return response<CreateSiteProvisioningKeyResponse>(res, {
            data: {
                siteProvisioningKeyId,
                orgId,
                name,
                siteProvisioningKey: provisioningKey,
                lastChars,
                createdAt,
                lastUsed: null,
                maxBatchSize,
                numUsed: 0,
                validUntil,
                approveNewSites
            },
            success: true,
            error: false,
            message: "Site provisioning key created",
            status: HttpCode.CREATED
        });
    } catch (e) {
        logger.error(e);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to create site provisioning key"
            )
        );
    }
}
