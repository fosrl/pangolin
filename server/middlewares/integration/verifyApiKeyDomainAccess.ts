import { Request, Response, NextFunction } from "express";
import { db, domains, orgDomains, apiKeyOrg } from "@server/db";
import { and, eq } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { getFirstString } from "@server/lib/requestParams";

export async function verifyApiKeyDomainAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const apiKey = req.apiKey;
        const domainId =
            getFirstString(req.params.domainId) ||
            getFirstString(req.body.domainId) ||
            getFirstString(req.query.domainId);
        const orgId = getFirstString(req.params.orgId);

        if (!apiKey) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "Key not authenticated")
            );
        }

        if (!domainId) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid domain ID")
            );
        }

        if (!orgId) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid organization ID")
            );
        }

        if (apiKey.isRoot) {
            // Root keys can access any domain in any org
            return next();
        }

        // Verify domain exists and belongs to the organization
        const [domain] = await db
            .select()
            .from(domains)
            .innerJoin(orgDomains, eq(orgDomains.domainId, domains.domainId))
            .where(
                and(
                    eq(orgDomains.domainId, domainId),
                    eq(orgDomains.orgId, orgId)
                )
            )
            .limit(1);

        if (!domain) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Domain with ID ${domainId} not found in organization ${orgId}`
                )
            );
        }

        // Verify the API key has access to this organization
        if (!req.apiKeyOrg) {
            const apiKeyOrgRes = await db
                .select()
                .from(apiKeyOrg)
                .where(
                    and(
                        eq(apiKeyOrg.apiKeyId, apiKey.apiKeyId),
                        eq(apiKeyOrg.orgId, orgId)
                    )
                )
                .limit(1);
            req.apiKeyOrg = apiKeyOrgRes[0];
        }

        if (!req.apiKeyOrg) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "Key does not have access to this organization"
                )
            );
        }

        return next();
    } catch (error) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error verifying domain access"
            )
        );
    }
}
