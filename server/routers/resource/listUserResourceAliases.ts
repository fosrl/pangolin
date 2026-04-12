import { Request, Response, NextFunction } from "express";
import {
    db,
    siteResources,
    userSiteResources,
    roleSiteResources,
    userOrgRoles,
    userOrgs
} from "@server/db";
import { and, eq, inArray, asc, isNotNull, ne } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import response from "@server/lib/response";
import logger from "@server/logger";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import type { PaginatedResponse } from "@server/types/Pagination";
import { OpenAPITags, registry } from "@server/openApi";
import { localCache } from "#dynamic/lib/cache";

const USER_RESOURCE_ALIASES_CACHE_TTL_SEC = 60;

function userResourceAliasesCacheKey(
    orgId: string,
    userId: string,
    page: number,
    pageSize: number
) {
    return `userResourceAliases:${orgId}:${userId}:${page}:${pageSize}`;
}

const listUserResourceAliasesParamsSchema = z.strictObject({
    orgId: z.string()
});

const listUserResourceAliasesQuerySchema = z.object({
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
        })
});

export type ListUserResourceAliasesResponse = PaginatedResponse<{
    aliases: string[];
}>;

// registry.registerPath({
//     method: "get",
//     path: "/org/{orgId}/user-resource-aliases",
//     description:
//         "List private (host-mode) site resource aliases the authenticated user can access in the organization, paginated.",
//     tags: [OpenAPITags.PrivateResource],
//     request: {
//         params: z.object({
//             orgId: z.string()
//         }),
//         query: listUserResourceAliasesQuerySchema
//     },
//     responses: {}
// });

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
        const { page, pageSize } = parsedQuery.data;

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
            pageSize
        );
        const cachedData: ListUserResourceAliasesResponse | undefined =
            localCache.get(cacheKey);

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
                pagination: {
                    total: 0,
                    pageSize,
                    page
                }
            };
            localCache.set(cacheKey, data, USER_RESOURCE_ALIASES_CACHE_TTL_SEC);
            return response<ListUserResourceAliasesResponse>(res, {
                data,
                success: true,
                error: false,
                message: "User resource aliases retrieved successfully",
                status: HttpCode.OK
            });
        }

        const whereClause = and(
            eq(siteResources.orgId, orgId),
            eq(siteResources.enabled, true),
            eq(siteResources.mode, "host"),
            isNotNull(siteResources.alias),
            ne(siteResources.alias, ""),
            inArray(siteResources.siteResourceId, accessibleSiteResourceIds)
        );

        const baseSelect = () =>
            db
                .select({ alias: siteResources.alias })
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

        const data: ListUserResourceAliasesResponse = {
            aliases,
            pagination: {
                total: totalCount,
                pageSize,
                page
            }
        };
        localCache.set(cacheKey, data, USER_RESOURCE_ALIASES_CACHE_TTL_SEC);

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
