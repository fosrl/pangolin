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
import { db, siteProvisioningKeyOrg, siteProvisioningKeys } from "@server/db";
import { and, eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import type { UpdateSiteProvisioningKeyResponse } from "@server/routers/siteProvisioning/types";
import { createApiResponseSchema } from "@server/lib/openapi/createApiResponseSchema";
import { OpenAPITags, registry } from "@server/openApi";

const paramsSchema = z.object({
    siteProvisioningKeyId: z.string().nonempty(),
    orgId: z.string().nonempty()
});

const bodySchema = z
    .strictObject({
        maxBatchSize: z
            .union([
                z.null(),
                z.coerce.number().int().positive().max(1_000_000)
            ])
            .optional()
            .openapi({
                type: "number",
                default: null,
                description:
                    "Maximum number of sites that can be provisioned in a single batch. If null, there is no limit."
            }),
        validUntil: z.string().max(255).optional(),
        approveNewSites: z.boolean().optional()
    })
    .superRefine((data, ctx) => {
        if (
            data.maxBatchSize === undefined &&
            data.validUntil === undefined &&
            data.approveNewSites === undefined
        ) {
            ctx.addIssue({
                code: "custom",
                message:
                    "Provide maxBatchSize and/or validUntil and/or approveNewSites",
                path: ["maxBatchSize"]
            });
        }
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

export type UpdateSiteProvisioningKeyBody = z.infer<typeof bodySchema>;

const UpdateSiteProvisioningKeyResponseDataSchema = z.object({
    siteProvisioningKeyId: z.string(),
    orgId: z.string(),
    name: z.string(),
    lastChars: z.string(),
    createdAt: z.string(),
    lastUsed: z.string().nullable(),
    maxBatchSize: z.number().nullable(),
    numUsed: z.number(),
    validUntil: z.string().nullable(),
    approveNewSites: z.boolean()
});

registry.registerPath({
    method: "patch",
    path: "/org/{orgId}/site-provisioning-key/{siteProvisioningKeyId}",
    description: "Update a site provisioning key.",
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
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: createApiResponseSchema(
                        UpdateSiteProvisioningKeyResponseDataSchema
                    )
                }
            }
        }
    }
});

export async function updateSiteProvisioningKey(
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

        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { siteProvisioningKeyId, orgId } = parsedParams.data;
        const body = parsedBody.data;

        const [row] = await db
            .select()
            .from(siteProvisioningKeys)
            .where(
                eq(
                    siteProvisioningKeys.siteProvisioningKeyId,
                    siteProvisioningKeyId
                )
            )
            .innerJoin(
                siteProvisioningKeyOrg,
                and(
                    eq(
                        siteProvisioningKeys.siteProvisioningKeyId,
                        siteProvisioningKeyOrg.siteProvisioningKeyId
                    ),
                    eq(siteProvisioningKeyOrg.orgId, orgId)
                )
            )
            .limit(1);

        if (!row) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Site provisioning key with ID ${siteProvisioningKeyId} not found`
                )
            );
        }

        const setValues: {
            maxBatchSize?: number | null;
            validUntil?: string | null;
            approveNewSites?: boolean;
        } = {};
        if (body.maxBatchSize !== undefined) {
            setValues.maxBatchSize = body.maxBatchSize;
        }
        if (body.validUntil !== undefined) {
            setValues.validUntil =
                body.validUntil.trim() === ""
                    ? null
                    : new Date(Date.parse(body.validUntil)).toISOString();
        }
        if (body.approveNewSites !== undefined) {
            setValues.approveNewSites = body.approveNewSites;
        }

        await db
            .update(siteProvisioningKeys)
            .set(setValues)
            .where(
                eq(
                    siteProvisioningKeys.siteProvisioningKeyId,
                    siteProvisioningKeyId
                )
            );

        const [updated] = await db
            .select({
                siteProvisioningKeyId:
                    siteProvisioningKeys.siteProvisioningKeyId,
                name: siteProvisioningKeys.name,
                lastChars: siteProvisioningKeys.lastChars,
                createdAt: siteProvisioningKeys.createdAt,
                lastUsed: siteProvisioningKeys.lastUsed,
                maxBatchSize: siteProvisioningKeys.maxBatchSize,
                numUsed: siteProvisioningKeys.numUsed,
                validUntil: siteProvisioningKeys.validUntil,
                approveNewSites: siteProvisioningKeys.approveNewSites
            })
            .from(siteProvisioningKeys)
            .where(
                eq(
                    siteProvisioningKeys.siteProvisioningKeyId,
                    siteProvisioningKeyId
                )
            )
            .limit(1);

        if (!updated) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Failed to load updated site provisioning key"
                )
            );
        }

        return response<UpdateSiteProvisioningKeyResponse>(res, {
            data: {
                ...updated,
                orgId
            },
            success: true,
            error: false,
            message: "Site provisioning key updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
