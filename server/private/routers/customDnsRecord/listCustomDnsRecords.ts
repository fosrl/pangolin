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
import { db, customDnsRecords, orgDomains } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, asc, eq } from "drizzle-orm";
import {
    ListCustomDnsRecordsResponse,
    toCustomDnsRecordRow
} from "@server/routers/customDnsRecord/types";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty(),
    domainId: z.string().nonempty()
});

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/domain/{domainId}/custom-dns-records",
    description:
        "List the custom DNS records served by Pangolin's nameservers for a domain.",
    tags: [OpenAPITags.Domain],
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

export async function listCustomDnsRecords(
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

        // Records per domain are capped (MAX_CUSTOM_DNS_RECORDS_PER_DOMAIN),
        // so no pagination is needed.
        const rows = await db
            .select({ record: customDnsRecords })
            .from(customDnsRecords)
            .innerJoin(
                orgDomains,
                eq(orgDomains.domainId, customDnsRecords.domainId)
            )
            .where(
                and(
                    eq(customDnsRecords.domainId, domainId),
                    eq(orgDomains.orgId, orgId)
                )
            )
            .orderBy(
                asc(customDnsRecords.fullDomain),
                asc(customDnsRecords.type),
                asc(customDnsRecords.customDnsRecordId)
            );

        return response<ListCustomDnsRecordsResponse>(res, {
            data: {
                records: rows.map((r) => toCustomDnsRecordRow(r.record))
            },
            success: true,
            error: false,
            message: "Custom DNS records retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
