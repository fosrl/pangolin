import { Request, Response, NextFunction } from "express";
import {
    db,
    siteResources,
    userSiteResources,
    roleSiteResources,
    userOrgRoles,
    userOrgs,
    labels,
    siteResourceLabels
} from "@server/db";
import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { and, eq, inArray, asc, isNotNull, ne, or } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import response from "@server/lib/response";
import logger from "@server/logger";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import type { PaginatedResponse } from "@server/types/Pagination";
import { regionalCache as cache } from "#dynamic/lib/cache";

const USER_RESOURCE_ALIASES_CACHE_TTL_SEC = 60;

const labelFilterQuerySchema = z
    .preprocess((val) => {
        if (val === undefined || val === null || val === "") {
            return undefined;
        }
        if (Array.isArray(val)) {
            return val;
        }
        if (typeof val === "string") {
            return val.split(",");
        }
        return undefined;
    }, z.array(z.string()))
    .optional()
    .catch([]);

function userResourceAliasesCacheKey(
    orgId: string,
    userId: string,
    page: number,
    pageSize: number,
    includeLabels: boolean,
    labelFilter: string[]
) {
    const labelsKey =
        labelFilter.length > 0 ? labelFilter.slice().sort().join(",") : "all";
    return `userResourceAliases:${orgId}:${userId}:${page}:${pageSize}:${includeLabels ? "labels" : "plain"}:${labelsKey}`;
}

const listUserResourceAliasesParamsSchema = z.strictObject({
    orgId: z.string()
});

const listUserResourceAliasesQuerySchema = z.strictObject({
    pageSize: z.coerce
        .number<string>()
        .int()
        .positive()
        .optional()
        .catch(20)
        .default(20)
        .openapi({
            type: "integer",
            default: 20,
            description: "Number of items per page"
        }),
    page: z.coerce
        .number<string>()
        .int()
        .min(0)
        .optional()
        .catch(1)
        .default(1)
        .openapi({
            type: "integer",
            default: 1,
            description: "Page number to retrieve"
        }),
    includeLabels: z
        .enum(["true", "false"])
        .optional()
        .default("false")
        .transform((val) => val === "true")
        .openapi({
            type: "boolean",
            default: false,
            description:
                "When true, include label names for each alias in the items field"
        }),
    labels: labelFilterQuerySchema.openapi({
        type: "array",
        description:
            "Filter by resource labels. A resource matches when it has any of the given labels (OR)."
    })
});

export type UserResourceAliasItem = {
    alias: string;
    labels: string[];
};

export type ListUserResourceAliasesResponse = PaginatedResponse<{
    aliases: string[];
    items?: UserResourceAliasItem[];
}>;

export async function listUserResourceAliases(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = listUserResourceAliasesQuerySchema.safeParse(
            req.query
        );
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsedQuery.error)
                )
            );
        }
        const {
            page,
            pageSize,
            includeLabels,
            labels: labelFilter
        } = parsedQuery.data;

        const parsedParams = listUserResourceAliasesParamsSchema.safeParse(
            req.params
        );
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsedParams.error)
                )
            );
        }

        const { orgId } = parsedParams.data;
        const userId = req.user?.userId;

        if (!userId) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
            );
        }

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

        const cacheKey = userResourceAliasesCacheKey(
            orgId,
            userId,
            page,
            pageSize,
            includeLabels,
            labelFilter ?? []
        );
        const cachedData: ListUserResourceAliasesResponse | undefined =
            await cache.get(cacheKey);

        if (cachedData) {
            return response<ListUserResourceAliasesResponse>(res, {
                data: cachedData,
                success: true,
                error: false,
                message: "User resource aliases retrieved successfully",
                status: HttpCode.OK
            });
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

        const [directSiteResourceResults, roleSiteResourceResults] =
            await Promise.all([
                directSiteResourcesQuery,
                roleSiteResourcesQuery
            ]);

        const accessibleSiteResourceIds = [
            ...directSiteResourceResults.map((r) => r.siteResourceId),
            ...roleSiteResourceResults.map((r) => r.siteResourceId)
        ];

        if (accessibleSiteResourceIds.length === 0) {
            const data: ListUserResourceAliasesResponse = {
                aliases: [],
                ...(includeLabels ? { items: [] } : {}),
                pagination: {
                    total: 0,
                    pageSize,
                    page
                }
            };
            await cache.set(
                cacheKey,
                data,
                USER_RESOURCE_ALIASES_CACHE_TTL_SEC
            );
            return response<ListUserResourceAliasesResponse>(res, {
                data,
                success: true,
                error: false,
                message: "User resource aliases retrieved successfully",
                status: HttpCode.OK
            });
        }

        const isLabelFeatureEnabled = await isLicensedOrSubscribed(
            orgId,
            tierMatrix.labels
        );

        const whereConditions = [
            eq(siteResources.orgId, orgId),
            eq(siteResources.enabled, true),
            or(eq(siteResources.mode, "host"), eq(siteResources.mode, "ssh")),
            isNotNull(siteResources.alias),
            ne(siteResources.alias, ""),
            inArray(siteResources.siteResourceId, accessibleSiteResourceIds)
        ];

        if (isLabelFeatureEnabled && labelFilter && labelFilter.length > 0) {
            whereConditions.push(
                inArray(
                    siteResources.siteResourceId,
                    db
                        .select({ id: siteResourceLabels.siteResourceId })
                        .from(siteResourceLabels)
                        .innerJoin(
                            labels,
                            eq(labels.labelId, siteResourceLabels.labelId)
                        )
                        .where(inArray(labels.name, labelFilter))
                )
            );
        }

        const whereClause = and(...whereConditions);

        const baseSelect = () =>
            db
                .select({
                    alias: siteResources.alias,
                    siteResourceId: siteResources.siteResourceId
                })
                .from(siteResources)
                .where(whereClause);

        const countQuery = db.$count(baseSelect().as("filtered_aliases"));

        const [rows, totalCount] = await Promise.all([
            baseSelect()
                .orderBy(asc(siteResources.alias))
                .limit(pageSize)
                .offset(pageSize * (page - 1)),
            countQuery
        ]);

        const aliases = rows.map((r) => r.alias as string);

        let items: UserResourceAliasItem[] | undefined;
        if (includeLabels) {
            const siteResourceIdList = rows.map((r) => r.siteResourceId);

            let labelsForSiteResources: Array<{
                name: string;
                siteResourceId: number;
            }> = [];

            if (isLabelFeatureEnabled && siteResourceIdList.length > 0) {
                labelsForSiteResources = await db
                    .select({
                        name: labels.name,
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
                    .orderBy(asc(siteResourceLabels.siteResourceLabelId));
            }

            items = rows.map((row) => ({
                alias: row.alias as string,
                labels: labelsForSiteResources
                    .filter((l) => l.siteResourceId === row.siteResourceId)
                    .map((l) => l.name)
            }));
        }

        const data: ListUserResourceAliasesResponse = {
            aliases,
            ...(items !== undefined ? { items } : {}),
            pagination: {
                total: totalCount,
                pageSize,
                page
            }
        };
        await cache.set(cacheKey, data, USER_RESOURCE_ALIASES_CACHE_TTL_SEC);

        return response<ListUserResourceAliasesResponse>(res, {
            data,
            success: true,
            error: false,
            message: "User resource aliases retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Internal server error"
            )
        );
    }
}
