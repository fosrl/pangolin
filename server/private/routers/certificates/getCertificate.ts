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
import { certificates, db, domains } from "@server/db";
import { eq, and, or, like } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { registry } from "@server/openApi";
import { GetCertificateResponse } from "@server/routers/certificates/types";

const getCertificateSchema = z.strictObject({
    domainId: z.string(),
    domain: z.string().min(1).max(255),
    orgId: z.string()
});

async function query(domainId: string, domain: string) {
    const [domainRecord] = await db
        .select()
        .from(domains)
        .where(eq(domains.domainId, domainId))
        .limit(1);

    if (!domainRecord) {
        throw new Error(`Domain with ID ${domainId} not found`);
    }

    const domainType = domainRecord.type;

    let existing: any[] = [];
    if (domainRecord.type == "ns" || domainRecord.type == "wildcard") {
        const domainLevelDown = domain.split(".").slice(1).join(".");
        const wildcardPrefixed = `*.${domainLevelDown}`;

        existing = await db
            .select({
                certId: certificates.certId,
                domain: certificates.domain,
                wildcard: certificates.wildcard,
                status: certificates.status,
                expiresAt: certificates.expiresAt,
                lastRenewalAttempt: certificates.lastRenewalAttempt,
                createdAt: certificates.createdAt,
                updatedAt: certificates.updatedAt,
                errorMessage: certificates.errorMessage,
                renewalCount: certificates.renewalCount
            })
            .from(certificates)
            .where(
                and(
                    eq(certificates.domainId, domainId),
                    or(
                        eq(certificates.domain, domain),
                        and(
                            eq(certificates.wildcard, true),
                            or(
                                eq(certificates.domain, domainLevelDown),
                                eq(certificates.domain, wildcardPrefixed)
                            )
                        )
                    )
                )
            );
    } else {
        // For non-NS domains, we only match exact domain names
        existing = await db
            .select({
                certId: certificates.certId,
                domain: certificates.domain,
                wildcard: certificates.wildcard,
                status: certificates.status,
                expiresAt: certificates.expiresAt,
                lastRenewalAttempt: certificates.lastRenewalAttempt,
                createdAt: certificates.createdAt,
                updatedAt: certificates.updatedAt,
                errorMessage: certificates.errorMessage,
                renewalCount: certificates.renewalCount
            })
            .from(certificates)
            .where(
                and(
                    eq(certificates.domainId, domainId),
                    eq(certificates.domain, domain) // exact match for non-NS domains
                )
            );
    }

    return existing.length > 0 ? { ...existing[0], domainType } : null;
}

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/certificate/{domainId}/{domain}",
    description: "Get a certificate by domain.",
    tags: ["Certificate"],
    request: {
        params: z.object({
            domainId: z.string(),
            domain: z.string().min(1).max(255),
            orgId: z.string()
        })
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

export async function getCertificate(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = getCertificateSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { domainId, domain } = parsedParams.data;

        const cert = await query(domainId, domain);

        if (!cert) {
            logger.warn(`Certificate not found for domain: ${domainId}`);
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Certificate not found")
            );
        }

        return response<GetCertificateResponse>(res, {
            data: cert,
            success: true,
            error: false,
            message: "Certificate retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
