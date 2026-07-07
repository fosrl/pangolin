import { Request, Response, NextFunction } from "express";
import { db } from "@server/db";
import { sites, Site, userOrgs, userSites, roleSites, roles } from "@server/db";
import { and, eq, inArray, or } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { checkOrgAccessPolicy } from "#dynamic/lib/checkOrgAccessPolicy";
import { getUserOrgRoleIds } from "@server/lib/userOrgRoles";

export async function verifySiteAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const userId = req.user!.userId; // Assuming you have user information in the request
    const siteIdStr =
        req.params?.siteId || req.body?.siteId || req.query?.siteId;
    const niceId = req.params?.niceId || req.body?.niceId || req.query?.niceId;
    const orgId = req.params?.orgId || req.body?.orgId || req.query?.orgId;

    if (!userId) {
        return next(
            createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
        );
    }

    try {
        let site: Site | null = null;

        if (niceId && orgId) {
            const [siteRes] = await db
                .select()
                .from(sites)
                .where(and(eq(sites.niceId, niceId), eq(sites.orgId, orgId)))
                .limit(1);

            site = siteRes;
        } else {
            const siteId = parseInt(siteIdStr);
            if (isNaN(siteId)) {
                return next(
                    createHttpError(HttpCode.BAD_REQUEST, "Invalid site ID")
                );
            }

            // Get the site
            const [siteRes] = await db
                .select()
                .from(sites)
                .where(eq(sites.siteId, siteId))
                .limit(1);

            site = siteRes;
        }

        if (!site) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Site with ID ${siteIdStr || niceId} not found`
                )
            );
        }

        if (!site.orgId) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    `Site with ID ${siteIdStr} does not have an organization ID`
                )
            );
        }

        if (req.userOrgId && site.orgId !== req.userOrgId) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not have access to this site"
                )
            );
        }

        if (!req.userOrg) {
            // Get user's role ID in the organization
            const userOrgRole = await db
                .select()
                .from(userOrgs)
                .where(
                    and(
                        eq(userOrgs.userId, userId),
                        eq(userOrgs.orgId, site.orgId)
                    )
                )
                .limit(1);
            req.userOrg = userOrgRole[0];
        }

        if (!req.userOrg || req.userOrg?.orgId !== site.orgId) {
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
            site.orgId
        );
        req.userOrgId = site.orgId;

        // Check role-based site access first (any of user's roles)
        const roleSiteAccess =
            (req.userOrgRoleIds?.length ?? 0) > 0
                ? await db
                      .select()
                      .from(roleSites)
                      .where(
                          and(
                              eq(roleSites.siteId, site.siteId),
                              inArray(roleSites.roleId, req.userOrgRoleIds!)
                          )
                      )
                      .limit(1)
                : [];

        if (roleSiteAccess.length > 0) {
            // User's role has access to the site
            return next();
        }

        // If role doesn't have access, check user-specific site access
        const userSiteAccess = await db
            .select()
            .from(userSites)
            .where(
                and(
                    eq(userSites.userId, userId),
                    eq(userSites.siteId, site.siteId)
                )
            )
            .limit(1);

        if (userSiteAccess.length > 0) {
            // User has direct access to the site
            return next();
        }

        // If we reach here, the user doesn't have access to the site
        return next(
            createHttpError(
                HttpCode.FORBIDDEN,
                "User does not have access to this site"
            )
        );
    } catch (error) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error verifying site access"
            )
        );
    }
}
