import { Request, Response, NextFunction } from "express";
import { aiModels, aiProviders, db, userOrgs } from "@server/db";
import { and, eq } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { checkOrgAccessPolicy } from "#dynamic/lib/checkOrgAccessPolicy";
import { getUserOrgRoleIds } from "@server/lib/userOrgRoles";
import { getFirstString } from "@server/lib/requestParams";

export async function verifyAiModelAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const userId = req.user!.userId;
        const modelIdRaw = getFirstString(req.params.modelId);
        const modelId = Number.parseInt(modelIdRaw ?? "", 10);

        if (!userId) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
            );
        }

        if (Number.isNaN(modelId)) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid model ID")
            );
        }

        const [row] = await db
            .select({
                model: aiModels,
                provider: aiProviders
            })
            .from(aiModels)
            .innerJoin(
                aiProviders,
                eq(aiModels.providerId, aiProviders.providerId)
            )
            .where(eq(aiModels.modelId, modelId))
            .limit(1);

        if (!row) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `AI model with ID ${modelId} not found`
                )
            );
        }

        const orgId = row.provider.orgId;

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
        req.aiProvider = row.provider;
        req.aiModel = row.model;

        return next();
    } catch (error) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error verifying AI model access"
            )
        );
    }
}
