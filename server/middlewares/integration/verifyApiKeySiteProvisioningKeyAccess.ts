import { Request, Response, NextFunction } from "express";
import {
    db,
    siteProvisioningKeys,
    siteProvisioningKeyOrg,
    apiKeyOrg
} from "@server/db";
import { and, eq } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { getFirstString } from "@server/lib/requestParams";

export async function verifyApiKeySiteProvisioningKeyAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const apiKey = req.apiKey;
        const siteProvisioningKeyId =
            getFirstString(req.params.siteProvisioningKeyId) ||
            getFirstString(req.body.siteProvisioningKeyId) ||
            getFirstString(req.query.siteProvisioningKeyId);
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

        if (!siteProvisioningKeyId) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid key ID")
            );
        }

        if (apiKey.isRoot) {
            // Root keys can access any site provisioning key in any org
            return next();
        }

        const [row] = await db
            .select()
            .from(siteProvisioningKeys)
            .innerJoin(
                siteProvisioningKeyOrg,
                and(
                    eq(
                        siteProvisioningKeys.siteProvisioningKeyId,
                        siteProvisioningKeyOrg.siteProvisioningKeyId
                    ),
                    eq(siteProvisioningKeyOrg.orgId, orgId)
                )
            )
            .where(
                eq(
                    siteProvisioningKeys.siteProvisioningKeyId,
                    siteProvisioningKeyId
                )
            )
            .limit(1);

        if (!row?.siteProvisioningKeys || !row.siteProvisioningKeyOrg) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Site provisioning key with ID ${siteProvisioningKeyId} not found for organization ${orgId}`
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
                        eq(apiKeyOrg.orgId, row.siteProvisioningKeyOrg.orgId)
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
                "Error verifying site provisioning key access"
            )
        );
    }
}
