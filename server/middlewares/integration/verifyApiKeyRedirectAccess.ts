import { Request, Response, NextFunction } from "express";
import { Redirect, apiKeyOrg, db, redirects } from "@server/db";
import { and, eq } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { getFirstString } from "@server/lib/requestParams";

export async function verifyApiKeyRedirectAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const apiKey = req.apiKey;
        const redirectIdRaw = getFirstString(req.params.redirectId);
        const niceId = getFirstString(req.params.niceId);
        const orgIdParam = getFirstString(req.params.orgId);

        if (!apiKey) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "Key not authenticated")
            );
        }

        if (!orgIdParam) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid organization ID")
            );
        }

        let redirect: Redirect | undefined;

        if (niceId) {
            const [redirectRes] = await db
                .select()
                .from(redirects)
                .where(
                    and(
                        eq(redirects.niceId, niceId),
                        eq(redirects.orgId, orgIdParam)
                    )
                )
                .limit(1);
            redirect = redirectRes;
        } else {
            const redirectId = Number.parseInt(redirectIdRaw ?? "", 10);

            if (Number.isNaN(redirectId)) {
                return next(
                    createHttpError(HttpCode.BAD_REQUEST, "Invalid redirect ID")
                );
            }

            const [redirectRes] = await db
                .select()
                .from(redirects)
                .where(
                    and(
                        eq(redirects.redirectId, redirectId),
                        eq(redirects.orgId, orgIdParam)
                    )
                )
                .limit(1);
            redirect = redirectRes;
        }

        if (!redirect) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Redirect with ID ${redirectIdRaw || niceId} not found`
                )
            );
        }

        if (apiKey.isRoot) {
            req.redirect = redirect;
            return next();
        }

        const orgId = redirect.orgId;

        if (!req.apiKeyOrg || req.apiKeyOrg.orgId !== orgId) {
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

        req.redirect = redirect;
        return next();
    } catch (error) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error verifying redirect access"
            )
        );
    }
}
