import { Request, Response, NextFunction } from "express";
import { db, DB_TYPE, type Label } from "@server/db";
import { and, asc, eq, or, inArray, sql } from "drizzle-orm";
import {
    resources,
    userResources,
    roleResources,
    userPolicies,
    rolePolicies,
    resourcePolicies,
    userOrgRoles,
    userOrgs,
    resourcePassword,
    resourcePincode,
    resourceWhitelist,
    resourcePolicyPassword,
    resourcePolicyPincode,
    resourcePolicyWhiteList,
    siteResources,
    userSiteResources,
    roleSiteResources,
    siteNetworks,
    sites,
    labels,
    resourceLabels,
    siteResourceLabels
} from "@server/db";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { response } from "@server/lib/response";
import { getFirstString } from "@server/lib/requestParams";
import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";
import { tierMatrix } from "@server/lib/billing/tierMatrix";

export async function getUserResources(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const effectiveResourcePolicyId = sql<
            number | null
        >`coalesce(${resources.resourcePolicyId}, ${resources.defaultResourcePolicyId})`;

        const orgId = getFirstString(req.params.orgId);
        const userId = req.user?.userId;

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
            .innerJoin(
                resources,
                eq(userResources.resourceId, resources.resourceId)
            )
            .where(
                and(
                    eq(userResources.userId, userId),
                    eq(resources.orgId, orgId)
                )
            );

        const roleResourcesQuery =
            userRoleIds.length > 0
                ? db
                      .select({ resourceId: roleResources.resourceId })
                      .from(roleResources)
                      .innerJoin(
                          resources,
                          eq(roleResources.resourceId, resources.resourceId)
                      )
                      .where(
                          and(
                              inArray(roleResources.roleId, userRoleIds),
                              eq(resources.orgId, orgId)
                          )
                      )
                : Promise.resolve([]);

        const directPolicyResourcesQuery = db
            .select({ resourceId: resources.resourceId })
            .from(resources)
            .innerJoin(
                userPolicies,
                eq(effectiveResourcePolicyId, userPolicies.resourcePolicyId)
            )
            .where(
                and(eq(userPolicies.userId, userId), eq(resources.orgId, orgId))
            );

        const rolePolicyResourcesQuery =
            userRoleIds.length > 0
                ? db
                      .select({ resourceId: resources.resourceId })
                      .from(resources)
                      .innerJoin(
                          rolePolicies,
                          eq(
                              effectiveResourcePolicyId,
                              rolePolicies.resourcePolicyId
                          )
                      )
                      .where(
                          and(
                              inArray(rolePolicies.roleId, userRoleIds),
                              eq(resources.orgId, orgId)
                          )
                      )
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

        const [
            directResources,
            roleResourceResults,
            directPolicyResourceResults,
            rolePolicyResourceResults,
            directSiteResourceResults,
            roleSiteResourceResults
        ] = await Promise.all([
            directResourcesQuery,
            roleResourcesQuery,
            directPolicyResourcesQuery,
            rolePolicyResourcesQuery,
            directSiteResourcesQuery,
            roleSiteResourcesQuery
        ]);

        // Combine all accessible resource IDs
        const accessibleResourceIds = [
            ...directResources.map((r) => r.resourceId),
            ...roleResourceResults.map((r) => r.resourceId),
            ...directPolicyResourceResults.map((r) => r.resourceId),
            ...rolePolicyResourceResults.map((r) => r.resourceId)
        ];

        // remove duplicates
        const uniqueResourceIds = Array.from(new Set(accessibleResourceIds));

        // Combine all accessible site resource IDs
        const accessibleSiteResourceIds = [
            ...directSiteResourceResults.map((r) => r.siteResourceId),
            ...roleSiteResourceResults.map((r) => r.siteResourceId)
        ];
        const uniqueSiteResourceIds = Array.from(
            new Set(accessibleSiteResourceIds)
        );

        // Get resource details for accessible resources
        let resourcesData: Array<{
            resourceId: number;
            effectiveResourcePolicyId: number | null;
            name: string;
            fullDomain: string | null;
            ssl: boolean;
            enabled: boolean;
            sso: boolean | null;
            mode: string;
            emailWhitelistEnabled: boolean | null;
            policyEmailWhitelistEnabled: boolean | null;
        }> = [];
        if (uniqueResourceIds.length > 0) {
            resourcesData = await db
                .select({
                    resourceId: resources.resourceId,
                    effectiveResourcePolicyId,
                    name: resources.name,
                    fullDomain: resources.fullDomain,
                    ssl: resources.ssl,
                    enabled: resources.enabled,
                    sso: resources.sso,
                    mode: resources.mode,
                    emailWhitelistEnabled: resources.emailWhitelistEnabled,
                    policyEmailWhitelistEnabled:
                        resourcePolicies.emailWhitelistEnabled
                })
                .from(resources)
                .leftJoin(
                    resourcePolicies,
                    eq(
                        effectiveResourcePolicyId,
                        resourcePolicies.resourcePolicyId
                    )
                )
                .where(
                    and(
                        inArray(resources.resourceId, uniqueResourceIds),
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
            scheme: string | null;
            ssl: boolean;
            fullDomain: string | null;
            enabled: boolean;
            alias: string | null;
            aliasAddress: string | null;
            tcpPortRangeString: string | null;
            udpPortRangeString: string | null;
            disableIcmp: boolean | null;
            siteIds: number[];
            siteNames: string[];
            siteNiceIds: string[];
            siteAddresses: (string | null)[];
            siteOnlines: boolean[];
        }> = [];
        if (uniqueSiteResourceIds.length > 0) {
            const aggCol = <T>(column: any) => {
                if (DB_TYPE === "sqlite") {
                    return sql<T>`json_group_array(${column})`;
                }
                return sql<T>`COALESCE(array_agg(${column}) FILTER (WHERE ${sites.siteId} IS NOT NULL), '{}')`;
            };

            const siteResourcesRaw = await db
                .select({
                    siteResourceId: siteResources.siteResourceId,
                    name: siteResources.name,
                    niceId: siteResources.niceId,
                    destination: siteResources.destination,
                    mode: siteResources.mode,
                    scheme: siteResources.scheme,
                    ssl: siteResources.ssl,
                    fullDomain: siteResources.fullDomain,
                    enabled: siteResources.enabled,
                    alias: siteResources.alias,
                    aliasAddress: siteResources.aliasAddress,
                    tcpPortRangeString: siteResources.tcpPortRangeString,
                    udpPortRangeString: siteResources.udpPortRangeString,
                    disableIcmp: siteResources.disableIcmp,
                    siteIds: aggCol<number[]>(sites.siteId),
                    siteNames: aggCol<string[]>(sites.name),
                    siteNiceIds: aggCol<string[]>(sites.niceId),
                    siteAddresses: aggCol<(string | null)[]>(sites.address),
                    siteOnlines: aggCol<boolean[]>(sites.online)
                })
                .from(siteResources)
                .leftJoin(
                    siteNetworks,
                    eq(siteResources.networkId, siteNetworks.networkId)
                )
                .leftJoin(sites, eq(siteNetworks.siteId, sites.siteId))
                .where(
                    and(
                        inArray(
                            siteResources.siteResourceId,
                            uniqueSiteResourceIds
                        ),
                        eq(siteResources.orgId, orgId),
                        eq(siteResources.enabled, true)
                    )
                )
                .groupBy(siteResources.siteResourceId);

            siteResourcesData = siteResourcesRaw.map((row: any) => {
                if (DB_TYPE !== "sqlite") {
                    return row;
                }
                const siteIdsRaw = JSON.parse(row.siteIds) as (number | null)[];
                const siteNamesRaw = JSON.parse(row.siteNames) as (
                    | string
                    | null
                )[];
                const siteNiceIdsRaw = JSON.parse(row.siteNiceIds) as (
                    | string
                    | null
                )[];
                const siteAddressesRaw = JSON.parse(row.siteAddresses) as (
                    | string
                    | null
                )[];
                const siteOnlinesRaw = JSON.parse(row.siteOnlines) as (
                    | 0
                    | 1
                    | null
                )[];

                const siteIds: number[] = [];
                const siteNames: string[] = [];
                const siteNiceIds: string[] = [];
                const siteAddresses: (string | null)[] = [];
                const siteOnlines: boolean[] = [];
                for (let i = 0; i < siteIdsRaw.length; i++) {
                    if (siteIdsRaw[i] == null) continue;
                    siteIds.push(siteIdsRaw[i] as number);
                    siteNames.push((siteNamesRaw[i] ?? "") as string);
                    siteNiceIds.push((siteNiceIdsRaw[i] ?? "") as string);
                    siteAddresses.push(siteAddressesRaw[i] ?? null);
                    siteOnlines.push(siteOnlinesRaw[i] === 1);
                }

                return {
                    ...row,
                    siteIds,
                    siteNames,
                    siteNiceIds,
                    siteAddresses,
                    siteOnlines
                };
            });
        }

        const resourceIdList = resourcesData.map((r) => r.resourceId);
        const siteResourceIdList = siteResourcesData.map(
            (r) => r.siteResourceId
        );

        const isLabelFeatureEnabled = await isLicensedOrSubscribed(
            orgId,
            tierMatrix.labels
        );

        let labelsForResources: Array<{
            labelId: number;
            name: string;
            color: string;
            resourceId: number;
        }> = [];
        let labelsForSiteResources: Array<{
            labelId: number;
            name: string;
            color: string;
            siteResourceId: number;
        }> = [];

        if (isLabelFeatureEnabled) {
            [labelsForResources, labelsForSiteResources] = await Promise.all([
                resourceIdList.length === 0
                    ? Promise.resolve([])
                    : db
                          .select({
                              labelId: labels.labelId,
                              name: labels.name,
                              color: labels.color,
                              resourceId: resourceLabels.resourceId
                          })
                          .from(labels)
                          .innerJoin(
                              resourceLabels,
                              eq(resourceLabels.labelId, labels.labelId)
                          )
                          .where(
                              inArray(resourceLabels.resourceId, resourceIdList)
                          )
                          .orderBy(asc(resourceLabels.resourceLabelId)),
                siteResourceIdList.length === 0
                    ? Promise.resolve([])
                    : db
                          .select({
                              labelId: labels.labelId,
                              name: labels.name,
                              color: labels.color,
                              siteResourceId: siteResourceLabels.siteResourceId
                          })
                          .from(labels)
                          .innerJoin(
                              siteResourceLabels,
                              eq(siteResourceLabels.labelId, labels.labelId)
                          )
                          .where(
                              inArray(
                                  siteResourceLabels.siteResourceId,
                                  siteResourceIdList
                              )
                          )
                          .orderBy(asc(siteResourceLabels.siteResourceLabelId))
            ]);
        }

        // Check for password, pincode, and whitelist protection for each resource
        const resourcesWithAuth = await Promise.all(
            resourcesData.map(async (resource) => {
                const policyId = resource.effectiveResourcePolicyId;

                const [
                    passwordCheck,
                    pincodeCheck,
                    whitelistCheck,
                    policyPasswordCheck,
                    policyPincodeCheck,
                    policyWhitelistCheck
                ] = await Promise.all([
                    db
                        .select()
                        .from(resourcePassword)
                        .where(
                            eq(resourcePassword.resourceId, resource.resourceId)
                        )
                        .limit(1),
                    db
                        .select()
                        .from(resourcePincode)
                        .where(
                            eq(resourcePincode.resourceId, resource.resourceId)
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
                        .limit(1),
                    policyId
                        ? db
                              .select()
                              .from(resourcePolicyPassword)
                              .where(
                                  eq(
                                      resourcePolicyPassword.resourcePolicyId,
                                      policyId
                                  )
                              )
                              .limit(1)
                        : Promise.resolve([]),
                    policyId
                        ? db
                              .select()
                              .from(resourcePolicyPincode)
                              .where(
                                  eq(
                                      resourcePolicyPincode.resourcePolicyId,
                                      policyId
                                  )
                              )
                              .limit(1)
                        : Promise.resolve([]),
                    policyId
                        ? db
                              .select()
                              .from(resourcePolicyWhiteList)
                              .where(
                                  eq(
                                      resourcePolicyWhiteList.resourcePolicyId,
                                      policyId
                                  )
                              )
                              .limit(1)
                        : Promise.resolve([])
                ]);

                const hasPassword =
                    passwordCheck.length > 0 || policyPasswordCheck.length > 0;
                const hasPincode =
                    pincodeCheck.length > 0 || policyPincodeCheck.length > 0;
                const hasWhitelist =
                    whitelistCheck.length > 0 ||
                    policyWhitelistCheck.length > 0 ||
                    resource.emailWhitelistEnabled ||
                    !!resource.policyEmailWhitelistEnabled;

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
                    mode: resource.mode,
                    sso: resource.sso,
                    password: hasPassword,
                    pincode: hasPincode,
                    whitelist: hasWhitelist,
                    labels: labelsForResources.filter(
                        (l) => l.resourceId === resource.resourceId
                    )
                };
            })
        );

        // Format site resources
        const siteResourcesFormatted = siteResourcesData.map((siteResource) => {
            return {
                siteResourceId: siteResource.siteResourceId,
                name: siteResource.name,
                niceId: siteResource.niceId,
                destination: siteResource.destination,
                mode: siteResource.mode,
                ssl: siteResource.ssl,
                fullDomain: siteResource.fullDomain,
                enabled: siteResource.enabled,
                alias: siteResource.alias,
                aliasAddress: siteResource.aliasAddress,
                tcpPortRangeString: siteResource.tcpPortRangeString,
                udpPortRangeString: siteResource.udpPortRangeString,
                disableIcmp: siteResource.disableIcmp,
                siteIds: siteResource.siteIds,
                siteNames: siteResource.siteNames,
                siteNiceIds: siteResource.siteNiceIds,
                siteAddresses: siteResource.siteAddresses,
                siteOnlines: siteResource.siteOnlines,
                type: "site" as const,
                labels: labelsForSiteResources.filter(
                    (l) => l.siteResourceId === siteResource.siteResourceId
                )
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
            mode: string;
            labels?: Array<Pick<Label, "color" | "labelId" | "name">>;
        }>;
        siteResources: Array<{
            siteResourceId: number;
            name: string;
            niceId: string;
            destination: string;
            mode: string;
            tcpPortRangeString: string | null;
            udpPortRangeString: string | null;
            disableIcmp: boolean | null;
            ssl: boolean;
            fullDomain: string | null;
            enabled: boolean;
            alias: string | null;
            aliasAddress: string | null;
            siteIds: number[];
            siteNames: string[];
            siteNiceIds: string[];
            siteAddresses: (string | null)[];
            siteOnlines: boolean[];
            type: "site";
            labels?: Array<Pick<Label, "color" | "labelId" | "name">>;
        }>;
    };
};
