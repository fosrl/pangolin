import { Request, Response, NextFunction } from "express";
import { AiProvider, aiProviders, db, userOrgs } from "@server/db";
import { and, eq } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { checkOrgAccessPolicy } from "#dynamic/lib/checkOrgAccessPolicy";
import { getUserOrgRoleIds } from "@server/lib/userOrgRoles";
import { getFirstString } from "@server/lib/requestParams";

export async function verifyAiProviderAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const userId = req.user!.userId;
        const providerIdRaw = getFirstString(req.params.providerId);
        const niceId = getFirstString(req.params.niceId);
        const orgIdParam = getFirstString(req.params.orgId);

        if (!userId) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
            );
        }

        let provider: AiProvider | undefined;

        if (niceId && orgIdParam) {
            const [providerRes] = await db
                .select()
                .from(aiProviders)
                .where(
                    and(
                        eq(aiProviders.niceId, niceId),
                        eq(aiProviders.orgId, orgIdParam)
                    )
                )
                .limit(1);
            provider = providerRes;
        } else {
            const providerId = Number.parseInt(providerIdRaw ?? "", 10);

            if (Number.isNaN(providerId)) {
                return next(
                    createHttpError(HttpCode.BAD_REQUEST, "Invalid provider ID")
                );
            }

            const [providerRes] = await db
                .select()
                .from(aiProviders)
                .where(eq(aiProviders.providerId, providerId))
                .limit(1);
            provider = providerRes;
        }

        if (!provider) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `AI provider with ID ${providerIdRaw || niceId} not found`
                )
            );
        }

        const orgId = provider.orgId;

        if (!req.userOrg || req.userOrg.orgId !== orgId) {
            const userOrgRole = await db
                .select()
                .from(userOrgs)
                .where(
                    and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, orgId))
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

        req.userOrgId = orgId;
        req.userOrgRoleIds = await getUserOrgRoleIds(req.userOrg.userId, orgId);
        req.aiProvider = provider;

        return next();
    } catch (error) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error verifying AI provider access"
            )
        );
    }
}
