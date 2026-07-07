import { Request, Response, NextFunction } from "express";
import { db } from "@server/db";
import { userOrgs, apiKeys, apiKeyOrg } from "@server/db";
import { and, eq } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { checkOrgAccessPolicy } from "#dynamic/lib/checkOrgAccessPolicy";
import { getUserOrgRoleIds } from "@server/lib/userOrgRoles";
import { getFirstString } from "@server/lib/requestParams";

export async function verifyApiKeyAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const userId = req.user!.userId;
        const apiKeyIdFromParams = getFirstString(req.params?.apiKeyId);
        const apiKeyIdFromBody = getFirstString(req.body?.apiKeyId);

        if (
            apiKeyIdFromParams &&
            apiKeyIdFromBody &&
            apiKeyIdFromParams !== apiKeyIdFromBody
        ) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "API key ID provided in both URL and body with different values"
                )
            );
        }

        const apiKeyId = apiKeyIdFromParams || apiKeyIdFromBody;
        const orgId = getFirstString(req.params.orgId);

        if (!userId) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
            );
        }

        if (!orgId) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid organization ID")
            );
        }

        if (!apiKeyId) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid key ID")
            );
        }

        const [apiKey] = await db
            .select()
            .from(apiKeys)
            .innerJoin(apiKeyOrg, eq(apiKeys.apiKeyId, apiKeyOrg.apiKeyId))
            .where(
                and(eq(apiKeys.apiKeyId, apiKeyId), eq(apiKeyOrg.orgId, orgId))
            )
            .limit(1);

        if (!apiKey.apiKeys) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `API key with ID ${apiKeyId} not found`
                )
            );
        }

        if (!apiKeyOrg.orgId) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    `API key with ID ${apiKeyId} does not have an organization ID`
                )
            );
        }

        if (!req.userOrg) {
            const userOrgRole = await db
                .select()
                .from(userOrgs)
                .where(
                    and(
                        eq(userOrgs.userId, userId),
                        eq(userOrgs.orgId, apiKeyOrg.orgId)
                    )
                )
                .limit(1);
            req.userOrg = userOrgRole[0];
        }

        if (!req.userOrg) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not have access to this organization"
                )
            );
        }

        if (req.orgPolicyAllowed === undefined && req.userOrg.orgId) {
            const policyCheck = await checkOrgAccessPolicy({
                orgId: req.userOrg.orgId,
                userId,
                session: req.session
            });
            req.orgPolicyAllowed = policyCheck.allowed;
            if (!policyCheck.allowed || policyCheck.error) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "" + (policyCheck.error || "Unknown error")
                    )
                );
            }
        }

        req.userOrgRoleIds = await getUserOrgRoleIds(req.userOrg.userId, orgId);

        return next();
    } catch (error) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error verifying key access"
            )
        );
    }
}
