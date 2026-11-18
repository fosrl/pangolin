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
import { and, eq } from "drizzle-orm";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty(),
    domainId: z.string().nonempty(),
    customDnsRecordId: z.coerce.number<string>().int().positive()
});

registry.registerPath({
    method: "delete",
    path: "/org/{orgId}/domain/{domainId}/custom-dns-record/{customDnsRecordId}",
    description: "Delete a custom DNS record from a domain.",
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

export async function deleteCustomDnsRecord(
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

        // Scope the record to a domain this org owns - the record id alone
        // must never be enough to reach another org's records.
        const [existing] = await db
            .select({ customDnsRecordId: customDnsRecords.customDnsRecordId })
            .from(customDnsRecords)
            .innerJoin(
                orgDomains,
                eq(orgDomains.domainId, customDnsRecords.domainId)
            )
            .where(
                and(
                    eq(customDnsRecords.customDnsRecordId, customDnsRecordId),
                    eq(customDnsRecords.domainId, domainId),
                    eq(orgDomains.orgId, orgId)
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

        await db
            .delete(customDnsRecords)
            .where(
                and(
                    eq(customDnsRecords.customDnsRecordId, customDnsRecordId),
                    eq(customDnsRecords.domainId, domainId)
                )
            );

        return response<null>(res, {
            data: null,
            success: true,
            error: false,
            message: "Custom DNS record deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
