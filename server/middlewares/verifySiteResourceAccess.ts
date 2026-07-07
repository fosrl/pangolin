import { Request, Response, NextFunction } from "express";
import { db, roleSiteResources, userOrgs, userSiteResources } from "@server/db";
import { siteResources } from "@server/db";
import { eq, and, inArray } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import logger from "@server/logger";
import { checkOrgAccessPolicy } from "#dynamic/lib/checkOrgAccessPolicy";
import { getUserOrgRoleIds } from "@server/lib/userOrgRoles";

export async function verifySiteResourceAccess(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const userId = req.user!.userId;
        const siteResourceId =
            req.params.siteResourceId ||
            req.body.siteResourceId ||
            req.query.siteResourceId;

        if (!userId) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
            );
        }

        if (!siteResourceId) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Site resource ID is required"
                )
            );
        }

        const siteResourceIdNum = parseInt(siteResourceId as string, 10);
        if (isNaN(siteResourceIdNum)) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Invalid site resource ID"
                )
            );
        }

        const [siteResource] = await db
            .select()
            .from(siteResources)
            .where(eq(siteResources.siteResourceId, siteResourceIdNum))
            .limit(1);

        if (!siteResource) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Site resource with ID ${siteResourceIdNum} not found`
                )
            );
        }

        if (!siteResource.orgId) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    `Site resource with ID ${siteResourceIdNum} does not have an organization ID`
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
                        eq(userOrgs.orgId, siteResource.orgId)
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
            siteResource.orgId
        );
        req.userOrgId = siteResource.orgId;

        // Attach the siteResource to the request for use in the next middleware/route
        req.siteResource = siteResource;

        const roleResourceAccess =
            (req.userOrgRoleIds?.length ?? 0) > 0
                ? await db
                      .select()
                      .from(roleSiteResources)
                      .where(
                          and(
                              eq(
                                  roleSiteResources.siteResourceId,
                                  siteResourceIdNum
                              ),
                              inArray(
                                  roleSiteResources.roleId,
                                  req.userOrgRoleIds!
                              )
                          )
                      )
                      .limit(1)
                : [];

        if (roleResourceAccess.length > 0) {
            return next();
        }

        const userResourceAccess = await db
            .select()
            .from(userSiteResources)
            .where(
                and(
                    eq(userSiteResources.userId, userId),
                    eq(userSiteResources.siteResourceId, siteResourceIdNum)
                )
            )
            .limit(1);

        if (userResourceAccess.length > 0) {
            return next();
        }

        return next(
            createHttpError(
                HttpCode.FORBIDDEN,
                "User does not have access to this resource"
            )
        );
    } catch (error) {
        logger.error("Error verifying site resource access:", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error verifying site resource access"
            )
        );
    }
}
