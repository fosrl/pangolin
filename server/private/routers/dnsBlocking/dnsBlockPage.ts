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
import { db, dnsBlockPageSettings, orgs } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { eq } from "drizzle-orm";
import { isLicensedOrSubscribed } from "#private/lib/isLicencedOrSubscribed";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import {
    DNS_BLOCK_PAGE_CONTACT_MAX,
    DNS_BLOCK_PAGE_MESSAGE_MAX,
    DNS_BLOCK_PAGE_TITLE_MAX,
    type DnsBlockPageValues,
    type GetDnsBlockPageResponse,
    type LoadDnsBlockPageResponse,
    type UpdateDnsBlockPageResponse
} from "@server/routers/dnsBlocking/types";

const orgParamsSchema = z.strictObject({
    orgId: z.string().nonempty()
});

// Empty or whitespace-only text means "use the default".
const optionalText = (max: number) =>
    z
        .string()
        .trim()
        .max(max)
        .nullable()
        .optional()
        .transform((v) => (v ? v : null));

const bodySchema = z.strictObject({
    title: optionalText(DNS_BLOCK_PAGE_TITLE_MAX),
    message: optionalText(DNS_BLOCK_PAGE_MESSAGE_MAX),
    contact: optionalText(DNS_BLOCK_PAGE_CONTACT_MAX)
});

const EMPTY: DnsBlockPageValues = { title: null, message: null, contact: null };

async function getValues(orgId: string): Promise<DnsBlockPageValues> {
    const [row] = await db
        .select()
        .from(dnsBlockPageSettings)
        .where(eq(dnsBlockPageSettings.orgId, orgId))
        .limit(1);
    if (!row) return EMPTY;
    return { title: row.title, message: row.message, contact: row.contact };
}

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/dns-block-page",
    description:
        "Get the wording of the page users see when they open a blocked site.",
    tags: [OpenAPITags.Org],
    request: { params: orgParamsSchema },
    responses: { 200: { description: "Successful response" } }
});

export async function getDnsBlockPage(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = orgParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }
        const { orgId } = parsedParams.data;

        return response<GetDnsBlockPageResponse>(res, {
            data: await getValues(orgId),
            success: true,
            error: false,
            message: "DNS block page retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}

registry.registerPath({
    method: "post",
    path: "/org/{orgId}/dns-block-page",
    description:
        "Update the wording of the page users see when they open a blocked site. Empty fields use the default text. Text may contain {{domain}} and {{orgName}}.",
    tags: [OpenAPITags.Org],
    request: {
        params: orgParamsSchema,
        body: { content: { "application/json": { schema: bodySchema } } }
    },
    responses: { 200: { description: "Successful response" } }
});

export async function updateDnsBlockPage(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = orgParamsSchema.safeParse(req.params);
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
        const values: DnsBlockPageValues = {
            title: parsedBody.data.title ?? null,
            message: parsedBody.data.message ?? null,
            contact: parsedBody.data.contact ?? null
        };

        await db.transaction(async (trx) => {
            await trx
                .delete(dnsBlockPageSettings)
                .where(eq(dnsBlockPageSettings.orgId, orgId));
            await trx.insert(dnsBlockPageSettings).values({ orgId, ...values });
        });

        return response<UpdateDnsBlockPageResponse>(res, {
            data: values,
            success: true,
            error: false,
            message: "DNS block page updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}

const loadQuerySchema = z.object({
    orgId: z.string().min(1)
});

/**
 * Internal, unauthenticated: what the public block page shows for an org. The
 * custom wording is only used while the org is licensed for DNS blocking.
 */
export async function loadDnsBlockPage(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = loadQuerySchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error).toString()
                )
            );
        }
        const { orgId } = parsedQuery.data;

        const [org] = await db
            .select({ name: orgs.name })
            .from(orgs)
            .where(eq(orgs.orgId, orgId))
            .limit(1);
        if (!org) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Organization not found")
            );
        }

        const licensed = await isLicensedOrSubscribed(
            orgId,
            tierMatrix.dnsBlocking
        );
        const values = licensed ? await getValues(orgId) : EMPTY;

        return response<LoadDnsBlockPageResponse>(res, {
            data: { ...values, orgName: org.name },
            success: true,
            error: false,
            message: "DNS block page retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
