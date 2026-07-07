import { Request, Response, NextFunction } from "express";
import { db } from "@server/db";
import { resourcePolicies, userOrgs } from "@server/db";
import { and, eq } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { checkOrgAccessPolicy } from "#dynamic/lib/checkOrgAccessPolicy";
import { getUserOrgRoleIds } from "@server/lib/userOrgRoles";

export async function verifyResourcePolicyAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const userId = req.user!.userId;
    const resourcePolicyIdStr =
        req.params?.resourcePolicyId ||
        req.body?.resourcePolicyId ||
        req.query?.resourcePolicyId;
    const niceId = req.params?.niceId || req.body?.niceId || req.query?.niceId;
    const orgId = req.params?.orgId || req.body?.orgId || req.query?.orgId;

    try {
        if (!userId) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
            );
        }

        let policy: typeof resourcePolicies.$inferSelect | null = null;

        if (orgId && niceId) {
            const [policyRes] = await db
                .select()
                .from(resourcePolicies)
                .where(
                    and(
                        eq(resourcePolicies.niceId, niceId),
                        eq(resourcePolicies.orgId, orgId)
                    )
                )
                .limit(1);
            policy = policyRes ?? null;
        } else {
            const resourcePolicyId = parseInt(resourcePolicyIdStr);
            if (isNaN(resourcePolicyId)) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Invalid resource policy ID"
                    )
                );
            }
            const [policyRes] = await db
                .select()
                .from(resourcePolicies)
                .where(eq(resourcePolicies.resourcePolicyId, resourcePolicyId))
                .limit(1);
            policy = policyRes ?? null;
        }

        if (!policy) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource policy with ID ${resourcePolicyIdStr ?? niceId} not found`
                )
            );
        }

        if (!req.userOrg) {
            const userOrgRes = await db
                .select()
                .from(userOrgs)
                .where(
                    and(
                        eq(userOrgs.userId, userId),
                        eq(userOrgs.orgId, policy.orgId)
                    )
                )
                .limit(1);
            req.userOrg = userOrgRes[0];
        }

        if (!req.userOrg || req.userOrg.orgId !== policy.orgId) {
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

        req.userOrgRoleIds = await getUserOrgRoleIds(
            req.userOrg.userId,
            policy.orgId
        );
        req.userOrgId = policy.orgId;

        return next();
    } catch (error) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error verifying resource policy access"
            )
        );
    }
}
