import { Request, Response, NextFunction } from "express";
import { db } from "@server/db";
import { aiProviders, resources, targets, userOrgs } from "@server/db";
import { and, eq } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { canUserAccessResource } from "../auth/canUserAccessResource";
import { checkOrgAccessPolicy } from "#dynamic/lib/checkOrgAccessPolicy";
import { getUserOrgRoleIds } from "@server/lib/userOrgRoles";
import { getFirstString } from "@server/lib/requestParams";

export async function verifyTargetAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const userId = req.user!.userId;
    const targetIdRaw = getFirstString(req.params.targetId);
    const targetId = Number.parseInt(targetIdRaw ?? "", 10);

    if (!userId) {
        return next(
            createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
        );
    }

    if (isNaN(targetId)) {
        return next(createHttpError(HttpCode.BAD_REQUEST, "Invalid target ID"));
    }

    const target = await db
        .select()
        .from(targets)
        .where(eq(targets.targetId, targetId))
        .limit(1);

    if (target.length === 0) {
        return next(
            createHttpError(
                HttpCode.NOT_FOUND,
                `Target with ID ${targetId} not found`
            )
        );
    }

    const { resourceId, providerId } = target[0];

    if ((!resourceId && !providerId) || (resourceId && providerId)) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                `Target with ID ${targetId} has invalid ownership`
            )
        );
    }

    try {
        let orgId: string;

        if (resourceId) {
            const [resource] = await db
                .select()
                .from(resources)
                .where(eq(resources.resourceId, resourceId))
                .limit(1);

            if (!resource) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `Resource with ID ${resourceId} not found`
                    )
                );
            }

            if (!resource.orgId) {
                return next(
                    createHttpError(
                        HttpCode.INTERNAL_SERVER_ERROR,
                        `Resource with ID ${resourceId} does not have an organization ID`
                    )
                );
            }

            orgId = resource.orgId;
        } else {
            const [provider] = await db
                .select()
                .from(aiProviders)
                .where(eq(aiProviders.providerId, providerId!))
                .limit(1);

            if (!provider) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `AI provider with ID ${providerId} not found`
                    )
                );
            }

            orgId = provider.orgId;
        }

        if (!req.userOrg) {
            const userOrgResult = await db
                .select()
                .from(userOrgs)
                .where(
                    and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, orgId))
                );
            req.userOrg = userOrgResult[0];
        }

        if (!req.userOrg || req.userOrg.orgId !== orgId) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not have access to this organization"
                )
            );
        }

        req.userOrgRoleIds = await getUserOrgRoleIds(req.userOrg.userId, orgId);
        req.userOrgId = orgId;

        if (req.orgPolicyAllowed === undefined) {
            const policyCheck = await checkOrgAccessPolicy({
                orgId,
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

        if (resourceId) {
            const resourceAllowed = await canUserAccessResource({
                userId,
                resourceId,
                roleIds: req.userOrgRoleIds ?? []
            });

            if (!resourceAllowed) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "User does not have access to this resource"
                    )
                );
            }
        }

        return next();
    } catch (e) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error verifying organization access"
            )
        );
    }
}
