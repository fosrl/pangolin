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
import { db, domainNamespaces } from "@server/db";
import { certificates } from "@server/db";
import { domains, orgDomains } from "@server/db";
import { eq, and } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import logger from "@server/logger";
import { getFirstString } from "@server/lib/requestParams";

export async function verifyCertificateAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        // Assume user/org access is already verified
        const orgId = getFirstString(req.params.orgId);

        const certIdFromParams = getFirstString(req.params?.certId);
        const certIdFromBody = getFirstString(req.body?.certId);

        if (
            certIdFromParams &&
            certIdFromBody &&
            certIdFromParams !== certIdFromBody
        ) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Certificate ID provided in both URL and body with different values"
                )
            );
        }

        const certId = certIdFromParams || certIdFromBody;

        const domainIdFromParams = getFirstString(req.params?.domainId);
        const domainIdFromBody = getFirstString(req.body?.domainId);

        if (
            domainIdFromParams &&
            domainIdFromBody &&
            domainIdFromParams !== domainIdFromBody
        ) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Domain ID provided in both URL and body with different values"
                )
            );
        }

        let domainId = domainIdFromParams || domainIdFromBody;

        if (!orgId) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid organization ID")
            );
        }

        if (!domainId) {
            if (!certId) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Must provide either certId or domainId"
                    )
                );
            }

            // Get the certificate and its domainId
            const [cert] = await db
                .select()
                .from(certificates)
                .where(eq(certificates.certId, Number(certId)))
                .limit(1);

            if (!cert) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `Certificate with ID ${certId} not found`
                    )
                );
            }

            domainId = cert.domainId ?? undefined;
            if (!domainId) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `Certificate with ID ${certId} does not have a domain`
                    )
                );
            }
        }

        if (!domainId) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Must provide either certId or domainId"
                )
            );
        }

        // Check if the domain is a namespace domain
        const [namespaceDomain] = await db
            .select()
            .from(domainNamespaces)
            .where(eq(domainNamespaces.domainId, domainId))
            .limit(1);

        if (namespaceDomain) {
            // If it's a namespace domain, we can skip the org check
            return next();
        }

        // Check if the domain is associated with the org
        const [orgDomain] = await db
            .select()
            .from(orgDomains)
            .where(
                and(
                    eq(orgDomains.orgId, orgId),
                    eq(orgDomains.domainId, domainId)
                )
            )
            .limit(1);

        if (!orgDomain) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "Organization does not have access to this certificate"
                )
            );
        }

        return next();
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error verifying certificate access"
            )
        );
    }
}
export default verifyCertificateAccess;
