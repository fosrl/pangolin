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
import { db, customDnsRecords } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, eq } from "drizzle-orm";
import {
    CreateOrUpdateCustomDnsRecordResponse,
    parseCustomDnsRecordValues,
    toCustomDnsRecordRow
} from "@server/routers/customDnsRecord/types";
import {
    checkCustomDnsRecordConflicts,
    customDnsRecordFieldsSchema,
    getManageableDomain,
    normalizeCustomDnsRecord
} from "./validation";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty(),
    domainId: z.string().nonempty(),
    customDnsRecordId: z.coerce.number<string>().int().positive()
});

const bodySchema = customDnsRecordFieldsSchema.partial();

registry.registerPath({
    method: "post",
    path: "/org/{orgId}/domain/{domainId}/custom-dns-record/{customDnsRecordId}",
    description: "Update a custom DNS record for a domain.",
    tags: [OpenAPITags.Domain],
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

export async function updateCustomDnsRecord(
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

        const { orgId, domainId, customDnsRecordId } = parsedParams.data;

        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const domain = await getManageableDomain(orgId, domainId);
        if (!domain.ok) {
            return next(createHttpError(domain.status, domain.error));
        }

        const [existing] = await db
            .select()
            .from(customDnsRecords)
            .where(
                and(
                    eq(customDnsRecords.customDnsRecordId, customDnsRecordId),
                    eq(customDnsRecords.domainId, domainId)
                )
            )
            .limit(1);

        if (!existing) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Custom DNS record with ID ${customDnsRecordId} not found`
                )
            );
        }

        // Validate the record as a whole, not just the changed fields, so a
        // partial update can't leave it in an invalid state.
        const normalized = normalizeCustomDnsRecord(
            {
                name: existing.name,
                type: existing.type,
                values: parseCustomDnsRecordValues(existing.values),
                ttl: existing.ttl,
                priority: existing.priority,
                weight: existing.weight,
                port: existing.port,
                enabled: existing.enabled,
                ...parsedBody.data
            },
            domain.baseDomain
        );
        if (!normalized.ok) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, normalized.error)
            );
        }

        const conflict = await checkCustomDnsRecordConflicts(
            domainId,
            domain.baseDomain,
            normalized.value,
            customDnsRecordId
        );
        if (conflict) {
            return next(createHttpError(HttpCode.CONFLICT, conflict));
        }

        const [record] = await db
            .update(customDnsRecords)
            .set({
                ...normalized.value,
                values: JSON.stringify(normalized.value.values),
                updatedAt: Date.now()
            })
            .where(
                and(
                    eq(customDnsRecords.customDnsRecordId, customDnsRecordId),
                    eq(customDnsRecords.domainId, domainId)
                )
            )
            .returning();

        return response<CreateOrUpdateCustomDnsRecordResponse>(res, {
            data: toCustomDnsRecordRow(record),
            success: true,
            error: false,
            message: "Custom DNS record updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
