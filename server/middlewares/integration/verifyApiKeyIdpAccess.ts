import { Request, Response, NextFunction } from "express";
import { db } from "@server/db";
import { idp, idpOrg, apiKeyOrg } from "@server/db";
import { and, eq } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { getFirstString } from "@server/lib/requestParams";

export async function verifyApiKeyIdpAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const apiKey = req.apiKey;
        const idpIdRaw =
            getFirstString(req.params.idpId) ||
            getFirstString(req.body.idpId) ||
            getFirstString(req.query.idpId);
        const idpId = Number.parseInt(idpIdRaw ?? "", 10);
        const orgId = getFirstString(req.params.orgId);

        if (!apiKey) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "Key not authenticated")
            );
        }

        if (!orgId) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid organization ID")
            );
        }

        if (Number.isNaN(idpId)) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid IDP ID")
            );
        }

        if (apiKey.isRoot) {
            // Root keys can access any IDP in any org
            return next();
        }

        const [idpRes] = await db
            .select()
            .from(idp)
            .innerJoin(idpOrg, eq(idp.idpId, idpOrg.idpId))
            .where(and(eq(idp.idpId, idpId), eq(idpOrg.orgId, orgId)))
            .limit(1);

        if (!idpRes || !idpRes.idp || !idpRes.idpOrg) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `IdP with ID ${idpId} not found for organization ${orgId}`
                )
            );
        }

        if (!req.apiKeyOrg) {
            const apiKeyOrgRes = await db
                .select()
                .from(apiKeyOrg)
                .where(
                    and(
                        eq(apiKeyOrg.apiKeyId, apiKey.apiKeyId),
                        eq(apiKeyOrg.orgId, idpRes.idpOrg.orgId)
                    )
                );
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
                "Error verifying IDP access"
            )
        );
    }
}
