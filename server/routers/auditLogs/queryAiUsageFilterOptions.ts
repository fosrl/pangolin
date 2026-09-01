import {
    db,
    logsDb,
    aiUsageRecords,
    aiProviders,
    resources,
    siteResources,
    users,
    roles,
    userOrgRoles,
    virtualApiKeys
} from "@server/db";
import { registry } from "@server/openApi";
import { NextFunction } from "express";
import { Request, Response } from "express";
import { and, eq, gte, lte, inArray, isNull, not } from "drizzle-orm";
import { OpenAPITags } from "@server/openApi";
import { z } from "zod";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { fromError } from "zod-validation-error";
import response from "@server/lib/response";
import logger from "@server/logger";
import { getSevenDaysAgo } from "@app/lib/getSevenDaysAgo";
import { DISTINCT_LIMIT } from "./aiUsageAnalyticsShared";

const queryAiUsageFilterOptionsQuery = z.object({
    timeStart: z
        .string()
        .refine((val) => !isNaN(Date.parse(val)), {
            error: "timeStart must be a valid ISO date string"
        })
        .transform((val) => Math.floor(new Date(val).getTime() / 1000))
        .prefault(() => getSevenDaysAgo().toISOString()),
    timeEnd: z
        .string()
        .refine((val) => !isNaN(Date.parse(val)), {
            error: "timeEnd must be a valid ISO date string"
        })
        .transform((val) => Math.floor(new Date(val).getTime() / 1000))
        .prefault(() => new Date().toISOString())
});

const queryAiUsageFilterOptionsParams = z.object({
    orgId: z.string()
});

const queryAiUsageFilterOptionsCombined = queryAiUsageFilterOptionsQuery.merge(
    queryAiUsageFilterOptionsParams
);
type Q = z.infer<typeof queryAiUsageFilterOptionsCombined>;

function sortNamedFilterOptions<T extends { id: number; name: string | null }>(
    items: T[]
): T[] {
    return [...items].sort((a, b) => {
        const nameA = a.name ?? "";
        const nameB = b.name ?? "";

        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;

        return a.id - b.id;
    });
}

async function query(data: Q) {
    const baseConditions = and(
        eq(aiUsageRecords.orgId, data.orgId),
        gte(aiUsageRecords.createdAt, data.timeStart),
        lte(aiUsageRecords.createdAt, data.timeEnd)
    );

    const [
        uniqueProviders,
        uniqueModels,
        uniqueResources,
        uniqueSiteResources,
        uniqueUsers,
        uniqueVirtualApiKeys
    ] = await Promise.all([
        logsDb
            .selectDistinct({ id: aiUsageRecords.providerId })
            .from(aiUsageRecords)
            .where(baseConditions)
            .limit(DISTINCT_LIMIT + 1),
        logsDb
            .selectDistinct({ model: aiUsageRecords.requestedModel })
            .from(aiUsageRecords)
            .where(baseConditions)
            .limit(DISTINCT_LIMIT + 1),
        logsDb
            .selectDistinct({ id: aiUsageRecords.resourceId })
            .from(aiUsageRecords)
            .where(and(baseConditions, not(isNull(aiUsageRecords.resourceId))))
            .limit(DISTINCT_LIMIT + 1),
        logsDb
            .selectDistinct({ id: aiUsageRecords.siteResourceId })
            .from(aiUsageRecords)
            .where(
                and(
                    baseConditions,
                    isNull(aiUsageRecords.resourceId),
                    not(isNull(aiUsageRecords.siteResourceId))
                )
            )
            .limit(DISTINCT_LIMIT + 1),
        logsDb
            .selectDistinct({ userId: aiUsageRecords.userId })
            .from(aiUsageRecords)
            .where(and(baseConditions, not(isNull(aiUsageRecords.userId))))
            .limit(DISTINCT_LIMIT + 1),
        logsDb
            .selectDistinct({ id: aiUsageRecords.virtualApiKeyId })
            .from(aiUsageRecords)
            .where(
                and(baseConditions, not(isNull(aiUsageRecords.virtualApiKeyId)))
            )
            .limit(DISTINCT_LIMIT + 1)
    ]);

    const models = uniqueModels
        .map((row) => row.model)
        .filter((model): model is string => model !== null)
        .sort();

    const providerIds = uniqueProviders
        .map((row) => row.id)
        .filter((id): id is number => id !== null);

    let providers: Array<{ id: number; name: string | null }> = [];
    if (providerIds.length > 0) {
        const providerDetails = await db
            .select({
                providerId: aiProviders.providerId,
                name: aiProviders.name
            })
            .from(aiProviders)
            .where(inArray(aiProviders.providerId, providerIds));

        providers = providerDetails.map((p) => ({
            id: p.providerId,
            name: p.name
        }));
    }

    const resourceIds = uniqueResources
        .map((row) => row.id)
        .filter((id): id is number => id !== null);
    const siteResourceIds = uniqueSiteResources
        .map((row) => row.id)
        .filter((id): id is number => id !== null);

    let resourcesWithNames: Array<{ id: number; name: string | null }> = [];
    if (resourceIds.length > 0) {
        const resourceDetails = await db
            .select({ resourceId: resources.resourceId, name: resources.name })
            .from(resources)
            .where(inArray(resources.resourceId, resourceIds));

        resourcesWithNames = resourcesWithNames.concat(
            resourceDetails.map((r) => ({ id: r.resourceId, name: r.name }))
        );
    }
    if (siteResourceIds.length > 0) {
        const siteResourceDetails = await db
            .select({
                siteResourceId: siteResources.siteResourceId,
                name: siteResources.name
            })
            .from(siteResources)
            .where(inArray(siteResources.siteResourceId, siteResourceIds));

        resourcesWithNames = resourcesWithNames.concat(
            siteResourceDetails.map((r) => ({
                id: r.siteResourceId,
                name: r.name
            }))
        );
    }

    const userIds = uniqueUsers
        .map((row) => row.userId)
        .filter((id): id is string => id !== null);

    let userList: Array<{ id: string; email: string | null }> = [];
    let roleList: Array<{ id: number; name: string | null }> = [];
    if (userIds.length > 0) {
        const userDetails = await db
            .select({ userId: users.userId, email: users.email })
            .from(users)
            .where(inArray(users.userId, userIds));
        userList = userDetails.map((u) => ({ id: u.userId, email: u.email }));

        const roleRows = await db
            .select({ roleId: roles.roleId, name: roles.name })
            .from(userOrgRoles)
            .innerJoin(roles, eq(userOrgRoles.roleId, roles.roleId))
            .where(
                and(
                    eq(userOrgRoles.orgId, data.orgId),
                    inArray(userOrgRoles.userId, userIds)
                )
            );

        const roleMap = new Map<number, string | null>();
        for (const r of roleRows) {
            roleMap.set(r.roleId, r.name);
        }
        roleList = [...roleMap.entries()].map(([id, name]) => ({ id, name }));
    }

    const virtualApiKeyIds = uniqueVirtualApiKeys
        .map((row) => row.id)
        .filter((id): id is string => id !== null);

    let virtualApiKeyList: Array<{
        id: string;
        name: string | null;
        lastChars: string;
    }> = [];
    if (virtualApiKeyIds.length > 0) {
        const virtualApiKeyDetails = await db
            .select({
                virtualApiKeyId: virtualApiKeys.virtualApiKeyId,
                name: virtualApiKeys.name,
                lastChars: virtualApiKeys.lastChars
            })
            .from(virtualApiKeys)
            .where(inArray(virtualApiKeys.virtualApiKeyId, virtualApiKeyIds));
        virtualApiKeyList = virtualApiKeyDetails.map((k) => ({
            id: k.virtualApiKeyId,
            name: k.name,
            lastChars: k.lastChars
        }));
    }

    return {
        providers: sortNamedFilterOptions(providers),
        resources: sortNamedFilterOptions(resourcesWithNames),
        roles: sortNamedFilterOptions(roleList),
        users: userList,
        virtualApiKeys: virtualApiKeyList,
        models
    };
}

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/logs/ai/usage/filters",
    description:
        "Query the distinct filter options (providers, models, resources, roles, users) available for AI usage analytics within a time range",
    tags: [OpenAPITags.Logs],
    request: {
        query: queryAiUsageFilterOptionsQuery,
        params: queryAiUsageFilterOptionsParams
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: z.object({
                        data: z.record(z.string(), z.any()).nullable(),
                        success: z.boolean(),
                        error: z.boolean(),
                        message: z.string(),
                        status: z.number()
                    })
                }
            }
        }
    }
});

export type QueryAiUsageFilterOptionsResponse = Awaited<
    ReturnType<typeof query>
>;

export async function queryAiUsageFilterOptions(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = queryAiUsageFilterOptionsQuery.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error)
                )
            );
        }

        const parsedParams = queryAiUsageFilterOptionsParams.safeParse(
            req.params
        );
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error)
                )
            );
        }

        const data = await query({ ...parsedQuery.data, ...parsedParams.data });

        return response<QueryAiUsageFilterOptionsResponse>(res, {
            data,
            success: true,
            error: false,
            message: "AI usage filter options retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
