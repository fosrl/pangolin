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
import {
    CreateOrUpdateCustomDnsRecordResponse,
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
    domainId: z.string().nonempty()
});

const bodySchema = customDnsRecordFieldsSchema.extend({
    ttl: customDnsRecordFieldsSchema.shape.ttl.optional().default(300),
    enabled: z.boolean().optional().default(true)
});

registry.registerPath({
    method: "put",
    path: "/org/{orgId}/domain/{domainId}/custom-dns-record",
    description:
        "Create a custom DNS record served by Pangolin's nameservers for a domain. Each entry in `values` is served as a separate resource record (e.g. both nameservers of an NS record).",
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

export async function createCustomDnsRecord(
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

        const { orgId, domainId } = parsedParams.data;

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

        const normalized = normalizeCustomDnsRecord(
            parsedBody.data,
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
            normalized.value
        );
        if (conflict) {
            return next(createHttpError(HttpCode.CONFLICT, conflict));
        }

        const now = Date.now();
        const [record] = await db
            .insert(customDnsRecords)
            .values({
                domainId,
                ...normalized.value,
                values: JSON.stringify(normalized.value.values),
                createdAt: now,
                updatedAt: now
            })
            .returning();

        return response<CreateOrUpdateCustomDnsRecordResponse>(res, {
            data: toCustomDnsRecordRow(record),
            success: true,
            error: false,
            message: "Custom DNS record created successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
