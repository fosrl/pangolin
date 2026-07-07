import { Request, Response, NextFunction } from "express";
import { db } from "@server/db";
import { resources, targets, userOrgs } from "@server/db";
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
        return next(
            createHttpError(HttpCode.BAD_REQUEST, "Invalid organization ID")
        );
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

    const resourceId = target[0].resourceId;

    if (!resourceId) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                `Target with ID ${targetId} does not have a resource ID`
            )
        );
    }

    try {
        const resource = await db
            .select()
            .from(resources)
            .where(eq(resources.resourceId, resourceId!))
            .limit(1);

        if (resource.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource with ID ${resourceId} not found`
                )
            );
        }

        if (!resource[0].orgId) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    `resource with ID ${resourceId} does not have an organization ID`
                )
            );
        }

        if (!req.userOrg) {
            const res = await db
                .select()
                .from(userOrgs)
                .where(
                    and(
                        eq(userOrgs.userId, userId),
                        eq(userOrgs.orgId, resource[0].orgId)
                    )
                );
            req.userOrg = res[0];
        }

        if (!req.userOrg) {
            next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not have access to this organization"
                )
            );
        } else {
            req.userOrgRoleIds = await getUserOrgRoleIds(
                req.userOrg.userId,
                resource[0].orgId!
            );
            req.userOrgId = resource[0].orgId!;
        }

        const orgId = req.userOrg.orgId;

        if (req.orgPolicyAllowed === undefined && orgId) {
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

        next();
    } catch (e) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error verifying organization access"
            )
        );
    }
}
