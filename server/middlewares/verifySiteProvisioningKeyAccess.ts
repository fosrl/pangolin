import { Request, Response, NextFunction } from "express";
import {
    db,
    userOrgs,
    siteProvisioningKeys,
    siteProvisioningKeyOrg
} from "@server/db";
import { and, eq } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { checkOrgAccessPolicy } from "#dynamic/lib/checkOrgAccessPolicy";
import { getUserOrgRoleIds } from "@server/lib/userOrgRoles";
import { getFirstString } from "@server/lib/requestParams";

export async function verifySiteProvisioningKeyAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const userId = req.user!.userId;
        const siteProvisioningKeyId = getFirstString(
            req.params.siteProvisioningKeyId
        );
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

        if (!siteProvisioningKeyId) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid key ID")
            );
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

        if (!row?.siteProvisioningKeys) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Site provisioning key with ID ${siteProvisioningKeyId} not found`
                )
            );
        }

        if (!row.siteProvisioningKeyOrg.orgId) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    `Site provisioning key with ID ${siteProvisioningKeyId} does not have an organization ID`
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
                        eq(userOrgs.orgId, row.siteProvisioningKeyOrg.orgId)
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

        req.userOrgRoleIds = await getUserOrgRoleIds(
            req.userOrg.userId,
            row.siteProvisioningKeyOrg.orgId
        );
        req.userOrgId = row.siteProvisioningKeyOrg.orgId;

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
