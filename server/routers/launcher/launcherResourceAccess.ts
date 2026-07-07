import { createHash } from "node:crypto";
import { db } from "@server/db";
import {
    exitNodes,
    labels,
    launcherViews,
    resourceLabels,
    resources,
    rolePolicies,
    roleResources,
    roles,
    roleSiteResources,
    siteNetworks,
    siteResourceLabels,
    siteResources,
    sites,
    targets,
    userOrgRoles,
    userPolicies,
    userResources,
    userSiteResources
} from "@server/db";
import { regionalCache as cache } from "#dynamic/lib/cache";
import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import {
    and,
    asc,
    countDistinct,
    eq,
    inArray,
    isNull,
    like,
    or,
    sql,
    type SQL
} from "drizzle-orm";
import {
    formatPublicResourceAccess,
    formatSiteResourceAccess
} from "./formatLauncherAccess";
import {
    LAUNCHER_FLAT_GROUP_KEY,
    LAUNCHER_NO_SITE_GROUP_KEY,
    LAUNCHER_UNLABELED_GROUP_KEY,
    type LauncherFilterListQuery,
    type LauncherGroup,
    type LauncherLabel,
    type LauncherListQuery,
    type LauncherResource,
    type LauncherSiteInfo,
    parseIdListParam
} from "./types";

const effectiveResourcePolicyId = sql<
    number | null
>`coalesce(${resources.resourcePolicyId}, ${resources.defaultResourcePolicyId})`;

export type AccessibleIds = {
    resourceIds: number[];
    siteResourceIds: number[];
};

const LAUNCHER_ACCESSIBLE_IDS_TTL_SEC = 60;
const LAUNCHER_RESOURCES_RESULT_TTL_SEC = 60;
const LAUNCHER_GROUPS_RESULT_TTL_SEC = 60;

type LauncherResourcesCacheEntry = {
    items: LauncherResource[];
    total: number;
};

type LauncherGroupsCacheEntry = {
    groups: LauncherGroup[];
    total: number;
};

function launcherListQueryHash(
    userRoleIds: number[],
    query: LauncherListQuery,
    extra?: Record<string, string>
) {
    const payload = JSON.stringify({
        roles: [...userRoleIds].sort((a, b) => a - b),
        query: query.query,
        groupBy: query.groupBy,
        siteIds: query.siteIds ?? "",
        labelIds: query.labelIds ?? "",
        sort_by: query.sort_by,
        order: query.order,
        ...extra
    });
    return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function launcherResourcesQueryHash(
    userRoleIds: number[],
    query: LauncherListQuery & { groupKey: string }
) {
    return launcherListQueryHash(userRoleIds, query, {
        groupKey: query.groupKey
    });
}

function launcherGroupsQueryHash(
    userRoleIds: number[],
    query: LauncherListQuery
) {
    return launcherListQueryHash(userRoleIds, query);
}

function launcherResourcesCacheKey(
    orgId: string,
    userId: string,
    queryHash: string
) {
    return `launcher:results:${orgId}:${userId}:${queryHash}`;
}

function launcherGroupsCacheKey(
    orgId: string,
    userId: string,
    queryHash: string
) {
    return `launcher:groups:${orgId}:${userId}:${queryHash}`;
}

function launcherAccessibleIdsCacheKey(
    orgId: string,
    userId: string,
    roleIds: number[]
) {
    const rolesKey = [...roleIds].sort((a, b) => a - b).join(",");
    return `launcherAccessibleIds:${orgId}:${userId}:${rolesKey}`;
}

async function resolveAccessibleIdsUncached(
    orgId: string,
    userId: string,
    userRoleIds: number[]
): Promise<AccessibleIds> {
    const [
        directResources,
        roleResourceResults,
        directPolicyResourceResults,
        rolePolicyResourceResults,
        directSiteResourceResults,
        roleSiteResourceResults
    ] = await Promise.all([
        db
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
            ),
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
            : Promise.resolve([]),
        db
            .select({ resourceId: resources.resourceId })
            .from(resources)
            .innerJoin(
                userPolicies,
                eq(effectiveResourcePolicyId, userPolicies.resourcePolicyId)
            )
            .where(
                and(eq(userPolicies.userId, userId), eq(resources.orgId, orgId))
            ),
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
            : Promise.resolve([]),
        db
            .select({ siteResourceId: userSiteResources.siteResourceId })
            .from(userSiteResources)
            .where(eq(userSiteResources.userId, userId)),
        userRoleIds.length > 0
            ? db
                  .select({
                      siteResourceId: roleSiteResources.siteResourceId
                  })
                  .from(roleSiteResources)
                  .where(inArray(roleSiteResources.roleId, userRoleIds))
            : Promise.resolve([])
    ]);

    return {
        resourceIds: Array.from(
            new Set([
                ...directResources.map((r) => r.resourceId),
                ...roleResourceResults.map((r) => r.resourceId),
                ...directPolicyResourceResults.map((r) => r.resourceId),
                ...rolePolicyResourceResults.map((r) => r.resourceId)
            ])
        ),
        siteResourceIds: Array.from(
            new Set([
                ...directSiteResourceResults.map((r) => r.siteResourceId),
                ...roleSiteResourceResults.map((r) => r.siteResourceId)
            ])
        )
    };
}

export async function resolveAccessibleIds(
    orgId: string,
    userId: string,
    userRoleIds: number[]
): Promise<AccessibleIds> {
    const cacheKey = launcherAccessibleIdsCacheKey(orgId, userId, userRoleIds);
    const cached = await cache.get<AccessibleIds>(cacheKey);
    if (cached) {
        return cached;
    }

    const result = await resolveAccessibleIdsUncached(
        orgId,
        userId,
        userRoleIds
    );
    await cache.set(cacheKey, result, LAUNCHER_ACCESSIBLE_IDS_TTL_SEC);
    return result;
}

function searchPattern(query: string) {
    return `%${query.trim()}%`;
}

function combineOrConditions(
    ...conditions: (SQL | undefined)[]
): SQL | undefined {
    const parts = conditions.filter(
        (condition): condition is SQL => !!condition
    );
    if (parts.length === 0) {
        return undefined;
    }
    if (parts.length === 1) {
        return parts[0];
    }
    return or(...parts);
}

function buildSearchConditionForPublic(
    query: string,
    labelsFeatureEnabled: boolean
) {
    if (!query.trim()) {
        return undefined;
    }
    const pattern = searchPattern(query.toLowerCase());
    const queryList = [
        like(sql`LOWER(${resources.name})`, pattern),
        like(sql`LOWER(${resources.fullDomain})`, pattern),
        like(sql`LOWER(cast(${resources.proxyPort} as text))`, pattern),
        inArray(
            resources.resourceId,
            db
                .select({ id: resources.resourceId })
                .from(resources)
                .leftJoin(targets, eq(targets.resourceId, resources.resourceId))
                .leftJoin(sites, eq(targets.siteId, sites.siteId))
                .leftJoin(exitNodes, eq(sites.exitNodeId, exitNodes.exitNodeId))
                .where(like(sql`LOWER(${exitNodes.endpoint})`, pattern))
        )
    ];

    if (labelsFeatureEnabled) {
        queryList.push(
            inArray(
                resources.resourceId,
                db
                    .select({ id: resourceLabels.resourceId })
                    .from(resourceLabels)
                    .innerJoin(
                        labels,
                        eq(labels.labelId, resourceLabels.labelId)
                    )
                    .where(like(sql`LOWER(${labels.name})`, pattern))
            )
        );
    }

    return or(...queryList);
}

function buildSearchConditionForSiteResource(
    query: string,
    labelsFeatureEnabled: boolean
) {
    if (!query.trim()) {
        return undefined;
    }
    const pattern = searchPattern(query.toLowerCase());
    const queryList = [
        like(sql`LOWER(${siteResources.name})`, pattern),
        like(sql`LOWER(${siteResources.destination})`, pattern),
        like(
            sql`LOWER(cast(${siteResources.destinationPort} as text))`,
            pattern
        ),
        like(sql`LOWER(${siteResources.scheme})`, pattern),
        like(sql`LOWER(${siteResources.alias})`, pattern),
        like(sql`LOWER(${siteResources.fullDomain})`, pattern),
        like(sql`LOWER(${siteResources.aliasAddress})`, pattern)
    ];

    if (labelsFeatureEnabled) {
        queryList.push(
            inArray(
                siteResources.siteResourceId,
                db
                    .select({ id: siteResourceLabels.siteResourceId })
                    .from(siteResourceLabels)
                    .innerJoin(
                        labels,
                        eq(labels.labelId, siteResourceLabels.labelId)
                    )
                    .where(like(sql`LOWER(${labels.name})`, pattern))
            )
        );
    }

    return or(...queryList);
}

async function filterPublicResourceIdsByTextSearch(
    orgId: string,
    resourceIds: number[],
    query: string,
    labelsFeatureEnabled: boolean
): Promise<number[]> {
    if (!query.trim() || resourceIds.length === 0) {
        return resourceIds;
    }

    const textMatch = combineOrConditions(
        buildSearchConditionForPublic(query, labelsFeatureEnabled),
        buildSiteNameSearchCondition(query)
    );
    if (!textMatch) {
        return resourceIds;
    }

    const rows = await db
        .selectDistinct({ resourceId: resources.resourceId })
        .from(resources)
        .leftJoin(targets, eq(targets.resourceId, resources.resourceId))
        .leftJoin(sites, eq(targets.siteId, sites.siteId))
        .where(
            and(
                inArray(resources.resourceId, resourceIds),
                eq(resources.orgId, orgId),
                eq(resources.enabled, true),
                textMatch
            )
        );

    return rows.map((row) => row.resourceId);
}

async function filterSiteResourceIdsByTextSearch(
    orgId: string,
    siteResourceIds: number[],
    query: string,
    labelsFeatureEnabled: boolean
): Promise<number[]> {
    if (!query.trim() || siteResourceIds.length === 0) {
        return siteResourceIds;
    }

    const textMatch = combineOrConditions(
        buildSearchConditionForSiteResource(query, labelsFeatureEnabled),
        buildSiteNameSearchCondition(query)
    );
    if (!textMatch) {
        return siteResourceIds;
    }

    const rows = await db
        .selectDistinct({ siteResourceId: siteResources.siteResourceId })
        .from(siteResources)
        .leftJoin(
            siteNetworks,
            eq(siteResources.networkId, siteNetworks.networkId)
        )
        .leftJoin(sites, eq(siteNetworks.siteId, sites.siteId))
        .where(
            and(
                inArray(siteResources.siteResourceId, siteResourceIds),
                eq(siteResources.orgId, orgId),
                eq(siteResources.enabled, true),
                textMatch
            )
        );

    return rows.map((row) => row.siteResourceId);
}

async function labelsEnabled(orgId: string): Promise<boolean> {
    return isLicensedOrSubscribed(orgId, tierMatrix.labels);
}

async function fetchLabelsForResources(
    orgId: string,
    resourceIds: number[],
    siteResourceIds: number[]
): Promise<{
    byResourceId: Map<number, LauncherLabel[]>;
    bySiteResourceId: Map<number, LauncherLabel[]>;
}> {
    const byResourceId = new Map<number, LauncherLabel[]>();
    const bySiteResourceId = new Map<number, LauncherLabel[]>();

    if (!(await labelsEnabled(orgId))) {
        return { byResourceId, bySiteResourceId };
    }

    const [resourceLabelRows, siteResourceLabelRows] = await Promise.all([
        resourceIds.length === 0
            ? Promise.resolve([])
            : db
                  .select({
                      resourceId: resourceLabels.resourceId,
                      labelId: labels.labelId,
                      name: labels.name,
                      color: labels.color
                  })
                  .from(resourceLabels)
                  .innerJoin(labels, eq(resourceLabels.labelId, labels.labelId))
                  .where(inArray(resourceLabels.resourceId, resourceIds))
                  .orderBy(asc(resourceLabels.resourceLabelId)),
        siteResourceIds.length === 0
            ? Promise.resolve([])
            : db
                  .select({
                      siteResourceId: siteResourceLabels.siteResourceId,
                      labelId: labels.labelId,
                      name: labels.name,
                      color: labels.color
                  })
                  .from(siteResourceLabels)
                  .innerJoin(
                      labels,
                      eq(siteResourceLabels.labelId, labels.labelId)
                  )
                  .where(
                      inArray(
                          siteResourceLabels.siteResourceId,
                          siteResourceIds
                      )
                  )
                  .orderBy(asc(siteResourceLabels.siteResourceLabelId))
    ]);

    for (const row of resourceLabelRows) {
        const list = byResourceId.get(row.resourceId) ?? [];
        list.push({
            labelId: row.labelId,
            name: row.name,
            color: row.color
        });
        byResourceId.set(row.resourceId, list);
    }

    for (const row of siteResourceLabelRows) {
        const list = bySiteResourceId.get(row.siteResourceId) ?? [];
        list.push({
            labelId: row.labelId,
            name: row.name,
            color: row.color
        });
        bySiteResourceId.set(row.siteResourceId, list);
    }

    return { byResourceId, bySiteResourceId };
}

type SiteGroupRow = {
    siteId: number;
    name: string;
    type: string;
    online: boolean;
    itemCount: number;
};

async function listSiteGroups(
    orgId: string,
    accessible: AccessibleIds,
    query: LauncherListQuery
): Promise<{ groups: LauncherGroup[]; total: number }> {
    const siteFilterIds = parseIdListParam(query.siteIds);
    const labelFilterIds = parseIdListParam(query.labelIds);
    const labelsFeatureEnabled = await labelsEnabled(orgId);
    const searchPublic = buildSearchConditionForPublic(
        query.query,
        labelsFeatureEnabled
    );
    const searchSite = buildSearchConditionForSiteResource(
        query.query,
        labelsFeatureEnabled
    );
    const siteCountMap = new Map<number, SiteGroupRow>();

    if (accessible.resourceIds.length > 0) {
        const publicConditions = [
            inArray(resources.resourceId, accessible.resourceIds),
            eq(resources.orgId, orgId),
            eq(resources.enabled, true)
        ];
        if (searchPublic) {
            publicConditions.push(searchPublic);
        }
        if (siteFilterIds.length > 0) {
            publicConditions.push(inArray(targets.siteId, siteFilterIds));
        }

        let publicQuery = db
            .select({
                siteId: sites.siteId,
                name: sites.name,
                type: sites.type,
                online: sites.online,
                itemCount: countDistinct(resources.resourceId)
            })
            .from(targets)
            .innerJoin(resources, eq(targets.resourceId, resources.resourceId))
            .innerJoin(sites, eq(targets.siteId, sites.siteId));

        if (labelFilterIds.length > 0) {
            publicQuery = publicQuery.innerJoin(
                resourceLabels,
                eq(resourceLabels.resourceId, resources.resourceId)
            );
            publicConditions.push(
                inArray(resourceLabels.labelId, labelFilterIds)
            );
        }

        const publicRows = await publicQuery
            .where(and(...publicConditions))
            .groupBy(sites.siteId, sites.name, sites.type, sites.online);

        for (const row of publicRows) {
            const existing = siteCountMap.get(row.siteId);
            if (existing) {
                existing.itemCount += Number(row.itemCount);
            } else {
                siteCountMap.set(row.siteId, {
                    siteId: row.siteId,
                    name: row.name,
                    type: row.type,
                    online: row.online,
                    itemCount: Number(row.itemCount)
                });
            }
        }
    }

    if (accessible.siteResourceIds.length > 0) {
        const siteConditions = [
            inArray(siteResources.siteResourceId, accessible.siteResourceIds),
            eq(siteResources.orgId, orgId),
            eq(siteResources.enabled, true)
        ];
        if (searchSite) {
            siteConditions.push(searchSite);
        }
        if (siteFilterIds.length > 0) {
            siteConditions.push(inArray(sites.siteId, siteFilterIds));
        }

        let siteResourceQuery = db
            .select({
                siteId: sites.siteId,
                name: sites.name,
                type: sites.type,
                online: sites.online,
                itemCount: countDistinct(siteResources.siteResourceId)
            })
            .from(siteResources)
            .innerJoin(
                siteNetworks,
                eq(siteResources.networkId, siteNetworks.networkId)
            )
            .innerJoin(sites, eq(siteNetworks.siteId, sites.siteId));

        if (labelFilterIds.length > 0) {
            siteResourceQuery = siteResourceQuery.innerJoin(
                siteResourceLabels,
                eq(
                    siteResourceLabels.siteResourceId,
                    siteResources.siteResourceId
                )
            );
            siteConditions.push(
                inArray(siteResourceLabels.labelId, labelFilterIds)
            );
        }

        const siteRows = await siteResourceQuery
            .where(and(...siteConditions))
            .groupBy(sites.siteId, sites.name, sites.type, sites.online);

        for (const row of siteRows) {
            const existing = siteCountMap.get(row.siteId);
            if (existing) {
                existing.itemCount += Number(row.itemCount);
            } else {
                siteCountMap.set(row.siteId, {
                    siteId: row.siteId,
                    name: row.name,
                    type: row.type,
                    online: row.online,
                    itemCount: Number(row.itemCount)
                });
            }
        }
    }

    let noSiteCount = 0;

    if (accessible.resourceIds.length > 0 && siteFilterIds.length === 0) {
        const noSitePublicConditions = [
            inArray(resources.resourceId, accessible.resourceIds),
            eq(resources.orgId, orgId),
            eq(resources.enabled, true)
        ];
        if (searchPublic) {
            noSitePublicConditions.push(searchPublic);
        }

        let noSitePublicQuery = db
            .select({
                itemCount: countDistinct(resources.resourceId)
            })
            .from(resources)
            .leftJoin(targets, eq(targets.resourceId, resources.resourceId));

        if (labelFilterIds.length > 0) {
            noSitePublicQuery = noSitePublicQuery.innerJoin(
                resourceLabels,
                eq(resourceLabels.resourceId, resources.resourceId)
            );
            noSitePublicConditions.push(
                inArray(resourceLabels.labelId, labelFilterIds)
            );
        }

        const [noSitePublicRow] = await noSitePublicQuery.where(
            and(...noSitePublicConditions, isNull(targets.targetId))
        );

        noSiteCount += Number(noSitePublicRow?.itemCount ?? 0);
    }

    if (accessible.siteResourceIds.length > 0 && siteFilterIds.length === 0) {
        const noSiteSiteConditions = [
            inArray(siteResources.siteResourceId, accessible.siteResourceIds),
            eq(siteResources.orgId, orgId),
            eq(siteResources.enabled, true)
        ];
        if (searchSite) {
            noSiteSiteConditions.push(searchSite);
        }

        let noSiteSiteQuery = db
            .select({
                itemCount: countDistinct(siteResources.siteResourceId)
            })
            .from(siteResources)
            .leftJoin(
                siteNetworks,
                eq(siteResources.networkId, siteNetworks.networkId)
            )
            .leftJoin(sites, eq(siteNetworks.siteId, sites.siteId));

        if (labelFilterIds.length > 0) {
            noSiteSiteQuery = noSiteSiteQuery.innerJoin(
                siteResourceLabels,
                eq(
                    siteResourceLabels.siteResourceId,
                    siteResources.siteResourceId
                )
            );
            noSiteSiteConditions.push(
                inArray(siteResourceLabels.labelId, labelFilterIds)
            );
        }

        const [noSiteSiteRow] = await noSiteSiteQuery.where(
            and(...noSiteSiteConditions, isNull(sites.siteId))
        );

        noSiteCount += Number(noSiteSiteRow?.itemCount ?? 0);
    }

    let groups: LauncherGroup[] = Array.from(siteCountMap.values()).map(
        (row) => ({
            groupKey: String(row.siteId),
            name: row.name,
            groupType: "site" as const,
            itemCount: row.itemCount,
            siteType: row.type,
            siteOnline: row.online
        })
    );

    if (noSiteCount > 0 && siteFilterIds.length === 0) {
        groups.push({
            groupKey: LAUNCHER_NO_SITE_GROUP_KEY,
            name: "No Site",
            groupType: "site",
            itemCount: noSiteCount
        });
    }

    groups.sort((a, b) => {
        const cmp = a.name.localeCompare(b.name, undefined, {
            sensitivity: "base"
        });
        return query.order === "desc" ? -cmp : cmp;
    });

    const total = groups.length;
    return {
        groups,
        total
    };
}

async function listLabelGroups(
    orgId: string,
    accessible: AccessibleIds,
    query: LauncherListQuery
): Promise<{ groups: LauncherGroup[]; total: number }> {
    const siteFilterIds = parseIdListParam(query.siteIds);
    const labelFilterIds = parseIdListParam(query.labelIds);
    const labelCountMap = new Map<
        number,
        { labelId: number; name: string; color: string; itemCount: number }
    >();
    let unlabeledCount = 0;

    if (!(await labelsEnabled(orgId))) {
        return { groups: [], total: 0 };
    }

    const matchesLabelFilters = (labelId: number) =>
        labelFilterIds.length === 0 || labelFilterIds.includes(labelId);

    if (accessible.resourceIds.length > 0) {
        const publicConditions = [
            inArray(resources.resourceId, accessible.resourceIds),
            eq(resources.orgId, orgId),
            eq(resources.enabled, true)
        ];
        const searchPublic = buildSearchConditionForPublic(query.query, true);
        if (searchPublic) {
            publicConditions.push(searchPublic);
        }
        if (siteFilterIds.length > 0) {
            publicConditions.push(inArray(targets.siteId, siteFilterIds));
        }

        const labeledPublic = await db
            .select({
                labelId: labels.labelId,
                name: labels.name,
                color: labels.color,
                itemCount: countDistinct(resources.resourceId)
            })
            .from(resourceLabels)
            .innerJoin(labels, eq(resourceLabels.labelId, labels.labelId))
            .innerJoin(
                resources,
                eq(resourceLabels.resourceId, resources.resourceId)
            )
            .leftJoin(targets, eq(targets.resourceId, resources.resourceId))
            .where(and(...publicConditions, eq(labels.orgId, orgId)))
            .groupBy(labels.labelId, labels.name, labels.color);

        for (const row of labeledPublic) {
            if (!matchesLabelFilters(row.labelId)) {
                continue;
            }
            const existing = labelCountMap.get(row.labelId);
            if (existing) {
                existing.itemCount += Number(row.itemCount);
            } else {
                labelCountMap.set(row.labelId, {
                    labelId: row.labelId,
                    name: row.name,
                    color: row.color,
                    itemCount: Number(row.itemCount)
                });
            }
        }

        const labeledPublicIds = await db
            .select({ resourceId: resourceLabels.resourceId })
            .from(resourceLabels)
            .innerJoin(
                resources,
                eq(resourceLabels.resourceId, resources.resourceId)
            )
            .leftJoin(targets, eq(targets.resourceId, resources.resourceId))
            .where(and(...publicConditions));

        const labeledSet = new Set(labeledPublicIds.map((r) => r.resourceId));
        unlabeledCount += accessible.resourceIds.filter(
            (id) => !labeledSet.has(id)
        ).length;
    }

    if (accessible.siteResourceIds.length > 0) {
        const siteConditions = [
            inArray(siteResources.siteResourceId, accessible.siteResourceIds),
            eq(siteResources.orgId, orgId),
            eq(siteResources.enabled, true)
        ];
        const searchSite = buildSearchConditionForSiteResource(
            query.query,
            true
        );
        if (searchSite) {
            siteConditions.push(searchSite);
        }
        if (siteFilterIds.length > 0) {
            siteConditions.push(inArray(sites.siteId, siteFilterIds));
        }

        const labeledSite = await db
            .select({
                labelId: labels.labelId,
                name: labels.name,
                color: labels.color,
                itemCount: countDistinct(siteResources.siteResourceId)
            })
            .from(siteResourceLabels)
            .innerJoin(labels, eq(siteResourceLabels.labelId, labels.labelId))
            .innerJoin(
                siteResources,
                eq(
                    siteResourceLabels.siteResourceId,
                    siteResources.siteResourceId
                )
            )
            .leftJoin(
                siteNetworks,
                eq(siteResources.networkId, siteNetworks.networkId)
            )
            .leftJoin(sites, eq(siteNetworks.siteId, sites.siteId))
            .where(and(...siteConditions, eq(labels.orgId, orgId)))
            .groupBy(labels.labelId, labels.name, labels.color);

        for (const row of labeledSite) {
            if (!matchesLabelFilters(row.labelId)) {
                continue;
            }
            const existing = labelCountMap.get(row.labelId);
            if (existing) {
                existing.itemCount += Number(row.itemCount);
            } else {
                labelCountMap.set(row.labelId, {
                    labelId: row.labelId,
                    name: row.name,
                    color: row.color,
                    itemCount: Number(row.itemCount)
                });
            }
        }

        const labeledSiteIds = await db
            .select({ siteResourceId: siteResourceLabels.siteResourceId })
            .from(siteResourceLabels)
            .innerJoin(
                siteResources,
                eq(
                    siteResourceLabels.siteResourceId,
                    siteResources.siteResourceId
                )
            )
            .leftJoin(
                siteNetworks,
                eq(siteResources.networkId, siteNetworks.networkId)
            )
            .leftJoin(sites, eq(siteNetworks.siteId, sites.siteId))
            .where(and(...siteConditions));

        const labeledSet = new Set(labeledSiteIds.map((r) => r.siteResourceId));
        unlabeledCount += accessible.siteResourceIds.filter(
            (id) => !labeledSet.has(id)
        ).length;
    }

    let groups: LauncherGroup[] = Array.from(labelCountMap.values()).map(
        (row) => ({
            groupKey: String(row.labelId),
            name: row.name,
            groupType: "label" as const,
            itemCount: row.itemCount,
            labelColor: row.color
        })
    );

    if (unlabeledCount > 0 && labelFilterIds.length === 0) {
        groups.push({
            groupKey: LAUNCHER_UNLABELED_GROUP_KEY,
            name: "Unlabeled",
            groupType: "label",
            itemCount: unlabeledCount,
            labelColor: "#a1a1aa"
        });
    }

    groups.sort((a, b) => {
        const cmp = a.name.localeCompare(b.name, undefined, {
            sensitivity: "base"
        });
        return query.order === "desc" ? -cmp : cmp;
    });

    const total = groups.length;
    return {
        groups,
        total
    };
}

async function listLauncherGroupsForUserUncached(
    orgId: string,
    userId: string,
    userRoleIds: number[],
    query: LauncherListQuery
): Promise<LauncherGroupsCacheEntry> {
    const accessible = await resolveAccessibleIds(orgId, userId, userRoleIds);

    if (query.groupBy === "label") {
        return listLabelGroups(orgId, accessible, query);
    }

    return listSiteGroups(orgId, accessible, query);
}

export async function listLauncherGroupsForUser(
    orgId: string,
    userId: string,
    userRoleIds: number[],
    query: LauncherListQuery
): Promise<{ groups: LauncherGroup[]; total: number }> {
    const queryHash = launcherGroupsQueryHash(userRoleIds, query);
    const cacheKey = launcherGroupsCacheKey(orgId, userId, queryHash);
    const cached = await cache.get<LauncherGroupsCacheEntry>(cacheKey);

    let result = cached;
    if (!result) {
        result = await listLauncherGroupsForUserUncached(
            orgId,
            userId,
            userRoleIds,
            query
        );
        await cache.set(cacheKey, result, LAUNCHER_GROUPS_RESULT_TTL_SEC);
    }

    const offset = (query.page - 1) * query.pageSize;
    return {
        groups: result.groups.slice(offset, offset + query.pageSize),
        total: result.total
    };
}

async function mapPublicResources(
    orgId: string,
    resourceIds: number[],
    labelMaps: Awaited<ReturnType<typeof fetchLabelsForResources>>,
    siteIdFilter?: number
): Promise<LauncherResource[]> {
    if (resourceIds.length === 0) {
        return [];
    }

    const rows = await db
        .select({
            resourceId: resources.resourceId,
            niceId: resources.niceId,
            name: resources.name,
            mode: resources.mode,
            fullDomain: resources.fullDomain,
            ssl: resources.ssl,
            proxyPort: resources.proxyPort,
            wildcard: resources.wildcard,
            enabled: resources.enabled,
            siteId: sites.siteId,
            siteName: sites.name,
            siteType: sites.type,
            siteOnline: sites.online,
            exitNodeEndpoint: exitNodes.endpoint
        })
        .from(resources)
        .leftJoin(targets, eq(targets.resourceId, resources.resourceId))
        .leftJoin(sites, eq(targets.siteId, sites.siteId))
        .leftJoin(exitNodes, eq(sites.exitNodeId, exitNodes.exitNodeId))
        .where(
            and(
                inArray(resources.resourceId, resourceIds),
                eq(resources.orgId, orgId),
                eq(resources.enabled, true),
                siteIdFilter != null
                    ? eq(sites.siteId, siteIdFilter)
                    : undefined
            )
        );

    const seen = new Set<string>();
    const result: LauncherResource[] = [];

    for (const row of rows) {
        const key = `public:${row.resourceId}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);

        const access = formatPublicResourceAccess({
            mode: row.mode,
            fullDomain: row.fullDomain,
            ssl: row.ssl,
            proxyPort: row.proxyPort,
            wildcard: row.wildcard,
            exitNodeEndpoint: row.exitNodeEndpoint
        });

        result.push({
            launcherResourceKey: key,
            resourceType: "public",
            resourceId: row.resourceId,
            niceId: row.niceId,
            name: row.name,
            ...access,
            iconUrl: null,
            enabled: row.enabled,
            mode: row.mode,
            labels: labelMaps.byResourceId.get(row.resourceId) ?? [],
            site:
                row.siteId != null
                    ? {
                          siteId: row.siteId,
                          name: row.siteName!,
                          type: row.siteType!,
                          online: row.siteOnline ?? undefined
                      }
                    : undefined
        });
    }

    return result;
}

async function mapSiteResources(
    orgId: string,
    siteResourceIds: number[],
    labelMaps: Awaited<ReturnType<typeof fetchLabelsForResources>>,
    siteIdFilter?: number
): Promise<LauncherResource[]> {
    if (siteResourceIds.length === 0) {
        return [];
    }

    const rows = await db
        .select({
            siteResourceId: siteResources.siteResourceId,
            niceId: siteResources.niceId,
            name: siteResources.name,
            mode: siteResources.mode,
            destination: siteResources.destination,
            destinationPort: siteResources.destinationPort,
            scheme: siteResources.scheme,
            ssl: siteResources.ssl,
            fullDomain: siteResources.fullDomain,
            alias: siteResources.alias,
            aliasAddress: siteResources.aliasAddress,
            enabled: siteResources.enabled,
            siteId: sites.siteId,
            siteName: sites.name,
            siteType: sites.type,
            siteOnline: sites.online
        })
        .from(siteResources)
        .leftJoin(
            siteNetworks,
            eq(siteResources.networkId, siteNetworks.networkId)
        )
        .leftJoin(sites, eq(siteNetworks.siteId, sites.siteId))
        .where(
            and(
                inArray(siteResources.siteResourceId, siteResourceIds),
                eq(siteResources.orgId, orgId),
                eq(siteResources.enabled, true),
                siteIdFilter != null
                    ? eq(sites.siteId, siteIdFilter)
                    : undefined
            )
        );

    const seen = new Set<string>();
    const result: LauncherResource[] = [];

    for (const row of rows) {
        const key = `site:${row.siteResourceId}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);

        const access = formatSiteResourceAccess({
            mode: row.mode,
            destination: row.destination,
            destinationPort: row.destinationPort,
            scheme: row.scheme,
            ssl: row.ssl,
            fullDomain: row.fullDomain,
            alias: row.alias,
            aliasAddress: row.aliasAddress
        });

        result.push({
            launcherResourceKey: key,
            resourceType: "site",
            resourceId: row.siteResourceId,
            siteResourceId: row.siteResourceId,
            niceId: row.niceId,
            name: row.name,
            ...access,
            iconUrl: null,
            enabled: row.enabled,
            mode: row.mode,
            labels: labelMaps.bySiteResourceId.get(row.siteResourceId) ?? [],
            site:
                row.siteId != null
                    ? {
                          siteId: row.siteId,
                          name: row.siteName!,
                          type: row.siteType!,
                          online: row.siteOnline ?? undefined
                      }
                    : undefined
        });
    }

    return result;
}

function filterResourcesBySite(
    items: LauncherResource[],
    groupKey: string
): LauncherResource[] {
    if (groupKey === LAUNCHER_NO_SITE_GROUP_KEY) {
        return items.filter((item) => !item.site);
    }
    const siteId = Number.parseInt(groupKey, 10);
    if (!Number.isFinite(siteId)) {
        return items;
    }
    return items.filter((item) => item.site?.siteId === siteId);
}

function filterResourcesByLabel(
    items: LauncherResource[],
    groupKey: string
): LauncherResource[] {
    if (groupKey === LAUNCHER_UNLABELED_GROUP_KEY) {
        return items.filter((item) => item.labels.length === 0);
    }
    const labelId = Number.parseInt(groupKey, 10);
    return items.filter((item) =>
        item.labels.some((label) => label.labelId === labelId)
    );
}

function sortLauncherResources(
    items: LauncherResource[],
    order: "asc" | "desc"
): LauncherResource[] {
    return [...items].sort((a, b) => {
        const cmp = a.name.localeCompare(b.name, undefined, {
            sensitivity: "base"
        });
        return order === "desc" ? -cmp : cmp;
    });
}

async function listLauncherResourcesForUserUncached(
    orgId: string,
    userId: string,
    userRoleIds: number[],
    query: LauncherListQuery & { groupKey: string }
): Promise<LauncherResourcesCacheEntry> {
    const accessible = await resolveAccessibleIds(orgId, userId, userRoleIds);

    const siteFilterIds = parseIdListParam(query.siteIds);
    const labelFilterIds = parseIdListParam(query.labelIds);

    let filteredResourceIds = accessible.resourceIds;
    let filteredSiteResourceIds = accessible.siteResourceIds;

    if (siteFilterIds.length > 0 && accessible.resourceIds.length > 0) {
        const publicOnSites = await db
            .select({ resourceId: resources.resourceId })
            .from(targets)
            .innerJoin(resources, eq(targets.resourceId, resources.resourceId))
            .where(
                and(
                    inArray(resources.resourceId, accessible.resourceIds),
                    inArray(targets.siteId, siteFilterIds)
                )
            );
        filteredResourceIds = publicOnSites.map((r) => r.resourceId);
    }

    if (siteFilterIds.length > 0 && accessible.siteResourceIds.length > 0) {
        const privateOnSites = await db
            .select({ siteResourceId: siteResources.siteResourceId })
            .from(siteResources)
            .innerJoin(
                siteNetworks,
                eq(siteResources.networkId, siteNetworks.networkId)
            )
            .where(
                and(
                    inArray(
                        siteResources.siteResourceId,
                        accessible.siteResourceIds
                    ),
                    inArray(siteNetworks.siteId, siteFilterIds)
                )
            );
        filteredSiteResourceIds = privateOnSites.map((r) => r.siteResourceId);
    }

    if (labelFilterIds.length > 0) {
        if (filteredResourceIds.length > 0) {
            const withLabels = await db
                .select({ resourceId: resourceLabels.resourceId })
                .from(resourceLabels)
                .where(
                    and(
                        inArray(resourceLabels.resourceId, filteredResourceIds),
                        inArray(resourceLabels.labelId, labelFilterIds)
                    )
                );
            filteredResourceIds = withLabels.map((r) => r.resourceId);
        }
        if (filteredSiteResourceIds.length > 0) {
            const withLabels = await db
                .select({ siteResourceId: siteResourceLabels.siteResourceId })
                .from(siteResourceLabels)
                .where(
                    and(
                        inArray(
                            siteResourceLabels.siteResourceId,
                            filteredSiteResourceIds
                        ),
                        inArray(siteResourceLabels.labelId, labelFilterIds)
                    )
                );
            filteredSiteResourceIds = withLabels.map((r) => r.siteResourceId);
        }
    }

    const labelsFeatureEnabled = await labelsEnabled(orgId);

    if (query.query.trim()) {
        if (filteredResourceIds.length > 0) {
            filteredResourceIds = await filterPublicResourceIdsByTextSearch(
                orgId,
                filteredResourceIds,
                query.query,
                labelsFeatureEnabled
            );
        }
        if (filteredSiteResourceIds.length > 0) {
            filteredSiteResourceIds = await filterSiteResourceIdsByTextSearch(
                orgId,
                filteredSiteResourceIds,
                query.query,
                labelsFeatureEnabled
            );
        }
    }

    const labelMaps = await fetchLabelsForResources(
        orgId,
        filteredResourceIds,
        filteredSiteResourceIds
    );

    const parsedSiteId =
        query.groupBy === "site" &&
        query.groupKey !== LAUNCHER_NO_SITE_GROUP_KEY
            ? Number.parseInt(query.groupKey, 10)
            : Number.NaN;
    const siteIdFilter = Number.isFinite(parsedSiteId)
        ? parsedSiteId
        : undefined;

    const [publicItems, siteItems] = await Promise.all([
        mapPublicResources(
            orgId,
            filteredResourceIds,
            labelMaps,
            Number.isFinite(siteIdFilter) ? siteIdFilter : undefined
        ),
        mapSiteResources(
            orgId,
            filteredSiteResourceIds,
            labelMaps,
            Number.isFinite(siteIdFilter) ? siteIdFilter : undefined
        )
    ]);

    let items = [...publicItems, ...siteItems];

    if (query.groupKey !== LAUNCHER_FLAT_GROUP_KEY) {
        if (query.groupBy === "label") {
            items = filterResourcesByLabel(items, query.groupKey);
        } else if (query.groupBy === "site") {
            items = filterResourcesBySite(items, query.groupKey);
        }
    }

    items = sortLauncherResources(items, query.order);

    return {
        items,
        total: items.length
    };
}

export async function listLauncherResourcesForUser(
    orgId: string,
    userId: string,
    userRoleIds: number[],
    query: LauncherListQuery & { groupKey: string }
): Promise<{ resources: LauncherResource[]; total: number }> {
    const queryHash = launcherResourcesQueryHash(userRoleIds, query);
    const cacheKey = launcherResourcesCacheKey(orgId, userId, queryHash);
    const cached = await cache.get<LauncherResourcesCacheEntry>(cacheKey);

    let result = cached;
    if (!result) {
        result = await listLauncherResourcesForUserUncached(
            orgId,
            userId,
            userRoleIds,
            query
        );
        await cache.set(cacheKey, result, LAUNCHER_RESOURCES_RESULT_TTL_SEC);
    }

    const offset = (query.page - 1) * query.pageSize;
    return {
        resources: result.items.slice(offset, offset + query.pageSize),
        total: result.total
    };
}

function buildSiteNameSearchCondition(query: string) {
    if (!query.trim()) {
        return undefined;
    }
    const pattern = searchPattern(query.toLowerCase());
    return or(
        like(sql`LOWER(${sites.name})`, pattern),
        like(sql`LOWER(${sites.niceId})`, pattern)
    );
}

function buildLabelNameSearchCondition(query: string) {
    if (!query.trim()) {
        return undefined;
    }
    const pattern = searchPattern(query.toLowerCase());
    return like(sql`LOWER(${labels.name})`, pattern);
}

async function collectAccessibleSites(
    orgId: string,
    accessible: AccessibleIds,
    siteNameSearch?: ReturnType<typeof buildSiteNameSearchCondition>
): Promise<Map<number, SiteGroupRow>> {
    const siteCountMap = new Map<number, SiteGroupRow>();

    if (accessible.resourceIds.length > 0) {
        const publicConditions = [
            inArray(resources.resourceId, accessible.resourceIds),
            eq(resources.orgId, orgId),
            eq(resources.enabled, true)
        ];
        if (siteNameSearch) {
            publicConditions.push(siteNameSearch);
        }

        const publicRows = await db
            .select({
                siteId: sites.siteId,
                name: sites.name,
                type: sites.type,
                online: sites.online,
                itemCount: countDistinct(resources.resourceId)
            })
            .from(targets)
            .innerJoin(resources, eq(targets.resourceId, resources.resourceId))
            .innerJoin(sites, eq(targets.siteId, sites.siteId))
            .where(and(...publicConditions))
            .groupBy(sites.siteId, sites.name, sites.type, sites.online);

        for (const row of publicRows) {
            const existing = siteCountMap.get(row.siteId);
            if (existing) {
                existing.itemCount += Number(row.itemCount);
            } else {
                siteCountMap.set(row.siteId, {
                    siteId: row.siteId,
                    name: row.name,
                    type: row.type,
                    online: row.online,
                    itemCount: Number(row.itemCount)
                });
            }
        }
    }

    if (accessible.siteResourceIds.length > 0) {
        const siteConditions = [
            inArray(siteResources.siteResourceId, accessible.siteResourceIds),
            eq(siteResources.orgId, orgId),
            eq(siteResources.enabled, true)
        ];
        if (siteNameSearch) {
            siteConditions.push(siteNameSearch);
        }

        const siteRows = await db
            .select({
                siteId: sites.siteId,
                name: sites.name,
                type: sites.type,
                online: sites.online,
                itemCount: countDistinct(siteResources.siteResourceId)
            })
            .from(siteResources)
            .innerJoin(
                siteNetworks,
                eq(siteResources.networkId, siteNetworks.networkId)
            )
            .innerJoin(sites, eq(siteNetworks.siteId, sites.siteId))
            .where(and(...siteConditions))
            .groupBy(sites.siteId, sites.name, sites.type, sites.online);

        for (const row of siteRows) {
            const existing = siteCountMap.get(row.siteId);
            if (existing) {
                existing.itemCount += Number(row.itemCount);
            } else {
                siteCountMap.set(row.siteId, {
                    siteId: row.siteId,
                    name: row.name,
                    type: row.type,
                    online: row.online,
                    itemCount: Number(row.itemCount)
                });
            }
        }
    }

    return siteCountMap;
}

async function collectAccessibleLabels(
    orgId: string,
    accessible: AccessibleIds,
    labelNameSearch?: ReturnType<typeof buildLabelNameSearchCondition>
): Promise<Map<number, LauncherLabel>> {
    const labelMap = new Map<number, LauncherLabel>();

    if (!(await labelsEnabled(orgId))) {
        return labelMap;
    }

    if (accessible.resourceIds.length > 0) {
        const publicConditions = [
            inArray(resources.resourceId, accessible.resourceIds),
            eq(resources.orgId, orgId),
            eq(resources.enabled, true),
            eq(labels.orgId, orgId)
        ];
        if (labelNameSearch) {
            publicConditions.push(labelNameSearch);
        }

        const labeledPublic = await db
            .select({
                labelId: labels.labelId,
                name: labels.name,
                color: labels.color
            })
            .from(resourceLabels)
            .innerJoin(labels, eq(resourceLabels.labelId, labels.labelId))
            .innerJoin(
                resources,
                eq(resourceLabels.resourceId, resources.resourceId)
            )
            .where(and(...publicConditions))
            .groupBy(labels.labelId, labels.name, labels.color);

        for (const row of labeledPublic) {
            labelMap.set(row.labelId, {
                labelId: row.labelId,
                name: row.name,
                color: row.color
            });
        }
    }

    if (accessible.siteResourceIds.length > 0) {
        const siteConditions = [
            inArray(siteResources.siteResourceId, accessible.siteResourceIds),
            eq(siteResources.orgId, orgId),
            eq(siteResources.enabled, true),
            eq(labels.orgId, orgId)
        ];
        if (labelNameSearch) {
            siteConditions.push(labelNameSearch);
        }

        const labeledSite = await db
            .select({
                labelId: labels.labelId,
                name: labels.name,
                color: labels.color
            })
            .from(siteResourceLabels)
            .innerJoin(labels, eq(siteResourceLabels.labelId, labels.labelId))
            .innerJoin(
                siteResources,
                eq(
                    siteResourceLabels.siteResourceId,
                    siteResources.siteResourceId
                )
            )
            .where(and(...siteConditions))
            .groupBy(labels.labelId, labels.name, labels.color);

        for (const row of labeledSite) {
            labelMap.set(row.labelId, {
                labelId: row.labelId,
                name: row.name,
                color: row.color
            });
        }
    }

    return labelMap;
}

export async function listAccessibleLauncherSitesForUser(
    orgId: string,
    userId: string,
    userRoleIds: number[],
    query: LauncherFilterListQuery
): Promise<{ sites: LauncherSiteInfo[]; total: number }> {
    const accessible = await resolveAccessibleIds(orgId, userId, userRoleIds);
    const siteNameSearch = buildSiteNameSearchCondition(query.query);
    const siteCountMap = await collectAccessibleSites(
        orgId,
        accessible,
        siteNameSearch
    );

    const sites: LauncherSiteInfo[] = Array.from(siteCountMap.values())
        .map((row) => ({
            siteId: row.siteId,
            name: row.name,
            type: row.type,
            online: row.online
        }))
        .sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        );

    const total = sites.length;
    const offset = (query.page - 1) * query.pageSize;
    return {
        sites: sites.slice(offset, offset + query.pageSize),
        total
    };
}

export async function listAccessibleLauncherLabelsForUser(
    orgId: string,
    userId: string,
    userRoleIds: number[],
    query: LauncherFilterListQuery
): Promise<{ labels: LauncherLabel[]; total: number }> {
    const accessible = await resolveAccessibleIds(orgId, userId, userRoleIds);
    const labelNameSearch = buildLabelNameSearchCondition(query.query);
    const labelMap = await collectAccessibleLabels(
        orgId,
        accessible,
        labelNameSearch
    );

    const labelsList = Array.from(labelMap.values()).sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );

    const total = labelsList.length;
    const offset = (query.page - 1) * query.pageSize;
    return {
        labels: labelsList.slice(offset, offset + query.pageSize),
        total
    };
}
