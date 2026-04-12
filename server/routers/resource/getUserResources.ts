import { Request, Response, NextFunction } from "express";
import { db } from "@server/db";
import { and, eq, or, inArray } from "drizzle-orm";
import {
    resources,
    userResources,
    roleResources,
    userOrgRoles,
    userOrgs,
    resourcePassword,
    resourcePincode,
    resourceWhitelist,
    siteResources,
    userSiteResources,
    roleSiteResources
} from "@server/db";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { response } from "@server/lib/response";

export async function getUserResources(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const { orgId } = req.params;
        const userId = req.user?.userId;

        if (!userId) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
            );
        }

        // Check user is in organization and get their role IDs
        const [userOrg] = await db
            .select()
            .from(userOrgs)
            .where(and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, orgId)))
            .limit(1);

        if (!userOrg) {
            return next(
                createHttpError(HttpCode.FORBIDDEN, "User not in organization")
            );
        }

        const userRoleIds = await db
            .select({ roleId: userOrgRoles.roleId })
            .from(userOrgRoles)
            .where(
                and(
                    eq(userOrgRoles.userId, userId),
                    eq(userOrgRoles.orgId, orgId)
                )
            )
            .then((rows) => rows.map((r) => r.roleId));

        // Get resources accessible through direct assignment or role assignment
        const directResourcesQuery = db
            .select({ resourceId: userResources.resourceId })
            .from(userResources)
            .where(eq(userResources.userId, userId));

        const roleResourcesQuery =
            userRoleIds.length > 0
                ? db
                      .select({ resourceId: roleResources.resourceId })
                      .from(roleResources)
                      .where(inArray(roleResources.roleId, userRoleIds))
                : Promise.resolve([]);

        const directSiteResourcesQuery = db
            .select({ siteResourceId: userSiteResources.siteResourceId })
            .from(userSiteResources)
            .where(eq(userSiteResources.userId, userId));

        const roleSiteResourcesQuery =
            userRoleIds.length > 0
                ? db
                      .select({
                          siteResourceId: roleSiteResources.siteResourceId
                      })
                      .from(roleSiteResources)
                      .where(inArray(roleSiteResources.roleId, userRoleIds))
                : Promise.resolve([]);

        const [directResources, roleResourceResults, directSiteResourceResults, roleSiteResourceResults] = await Promise.all([
            directResourcesQuery,
            roleResourcesQuery,
            directSiteResourcesQuery,
            roleSiteResourcesQuery
        ]);

        // Combine all accessible resource IDs
        const accessibleResourceIds = [
            ...directResources.map((r) => r.resourceId),
            ...roleResourceResults.map((r) => r.resourceId)
        ];

        // Combine all accessible site resource IDs
        const accessibleSiteResourceIds = [
            ...directSiteResourceResults.map((r) => r.siteResourceId),
            ...roleSiteResourceResults.map((r) => r.siteResourceId)
        ];

        // Get resource details for accessible resources
        let resourcesData: Array<{
            resourceId: number;
            name: string;
            fullDomain: string | null;
            ssl: boolean;
            enabled: boolean;
            sso: boolean;
            protocol: string;
            emailWhitelistEnabled: boolean;
        }> = [];
        if (accessibleResourceIds.length > 0) {
            resourcesData = await db
            .select({
                resourceId: resources.resourceId,
                name: resources.name,
                fullDomain: resources.fullDomain,
                ssl: resources.ssl,
                enabled: resources.enabled,
                sso: resources.sso,
                protocol: resources.protocol,
                emailWhitelistEnabled: resources.emailWhitelistEnabled
            })
            .from(resources)
            .where(
                and(
                    inArray(resources.resourceId, accessibleResourceIds),
                    eq(resources.orgId, orgId),
                    eq(resources.enabled, true)
                )
            );
        }

        // Get site resource details for accessible site resources
        let siteResourcesData: Array<{
            siteResourceId: number;
            name: string;
            niceId: string;
            destination: string;
            mode: string;
            protocol: string | null;
            enabled: boolean;
            alias: string | null;
            aliasAddress: string | null;
        }> = [];
        if (accessibleSiteResourceIds.length > 0) {
            siteResourcesData = await db
                .select({
                    siteResourceId: siteResources.siteResourceId,
                    name: siteResources.name,
                    niceId: siteResources.niceId,
                    destination: siteResources.destination,
                    mode: siteResources.mode,
                    protocol: siteResources.protocol,
                    enabled: siteResources.enabled,
                    alias: siteResources.alias,
                    aliasAddress: siteResources.aliasAddress
                })
                .from(siteResources)
                .where(
                    and(
                        inArray(siteResources.siteResourceId, accessibleSiteResourceIds),
                        eq(siteResources.orgId, orgId),
                        eq(siteResources.enabled, true)
                    )
                );
        }

        // Check for password, pincode, and whitelist protection for each resource
        const resourcesWithAuth = await Promise.all(
            resourcesData.map(async (resource) => {
                const [passwordCheck, pincodeCheck, whitelistCheck] =
                    await Promise.all([
                        db
                            .select()
                            .from(resourcePassword)
                            .where(
                                eq(
                                    resourcePassword.resourceId,
                                    resource.resourceId
                                )
                            )
                            .limit(1),
                        db
                            .select()
                            .from(resourcePincode)
                            .where(
                                eq(
                                    resourcePincode.resourceId,
                                    resource.resourceId
                                )
                            )
                            .limit(1),
                        db
                            .select()
                            .from(resourceWhitelist)
                            .where(
                                eq(
                                    resourceWhitelist.resourceId,
                                    resource.resourceId
                                )
                            )
                            .limit(1)
                    ]);

                const hasPassword = passwordCheck.length > 0;
                const hasPincode = pincodeCheck.length > 0;
                const hasWhitelist =
                    whitelistCheck.length > 0 || resource.emailWhitelistEnabled;

                return {
                    resourceId: resource.resourceId,
                    name: resource.name,
                    domain: `${resource.ssl ? "https://" : "http://"}${resource.fullDomain}`,
                    enabled: resource.enabled,
                    protected: !!(
                        resource.sso ||
                        hasPassword ||
                        hasPincode ||
                        hasWhitelist
                    ),
                    protocol: resource.protocol,
                    sso: resource.sso,
                    password: hasPassword,
                    pincode: hasPincode,
                    whitelist: hasWhitelist
                };
            })
        );

        // Format site resources
        const siteResourcesFormatted = siteResourcesData.map((siteResource) => {
            return {
                siteResourceId: siteResource.siteResourceId,
                name: siteResource.name,
                destination: siteResource.destination,
                mode: siteResource.mode,
                protocol: siteResource.protocol,
                enabled: siteResource.enabled,
                alias: siteResource.alias,
                aliasAddress: siteResource.aliasAddress,
                type: 'site' as const
            };
        });

        return response(res, {
            data: {
                resources: resourcesWithAuth,
                siteResources: siteResourcesFormatted
            },
            success: true,
            error: false,
            message: "User resources retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        console.error("Error fetching user resources:", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Internal server error"
            )
        );
    }
}

export type GetUserResourcesResponse = {
    success: boolean;
    data: {
        resources: Array<{
            resourceId: number;
            name: string;
            domain: string;
            enabled: boolean;
            protected: boolean;
            protocol: string;
        }>;
        siteResources: Array<{
            siteResourceId: number;
            name: string;
            destination: string;
            mode: string;
            protocol: string | null;
            enabled: boolean;
            alias: string | null;
            aliasAddress: string | null;
            type: 'site';
        }>;
    };
};
