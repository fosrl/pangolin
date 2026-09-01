import { and, eq, gte, lte, or, inArray, sql } from "drizzle-orm";
import { aiUsageRecords, userOrgRoles, driver, db } from "@server/db";
import { z } from "zod";
import { getSevenDaysAgo } from "@app/lib/getSevenDaysAgo";

// Cap on how many distinct series a trend chart will plot before collapsing
// the remainder into an "other" bucket - matches the theme's 5 categorical
// chart colors (--chart-1..--chart-5).
export const TOP_N = 5;

// Same guard used by queryRequestAnalytics/queryAiSessionLog for distinct
// breakdown lists.
export const DISTINCT_LIMIT = 500;

export const aiUsageAnalyticsFiltersQuery = z.object({
    timeStart: z
        .string()
        .refine((val) => !isNaN(Date.parse(val)), {
            error: "timeStart must be a valid ISO date string"
        })
        .transform((val) => Math.floor(new Date(val).getTime() / 1000))
        .prefault(() => getSevenDaysAgo().toISOString())
        .openapi({
            type: "string",
            format: "date-time",
            description:
                "Start time as ISO date string (defaults to 7 days ago)"
        }),
    timeEnd: z
        .string()
        .refine((val) => !isNaN(Date.parse(val)), {
            error: "timeEnd must be a valid ISO date string"
        })
        .transform((val) => Math.floor(new Date(val).getTime() / 1000))
        .prefault(() => new Date().toISOString())
        .openapi({
            type: "string",
            format: "date-time",
            description:
                "End time as ISO date string (defaults to current time)"
        }),
    providerId: z
        .string()
        .optional()
        .transform(Number)
        .pipe(z.int().positive())
        .optional(),
    model: z.string().optional(),
    resourceId: z
        .string()
        .optional()
        .transform(Number)
        .pipe(z.int().positive())
        .optional(),
    roleId: z
        .string()
        .optional()
        .transform(Number)
        .pipe(z.int().positive())
        .optional(),
    userId: z.string().optional(),
    virtualApiKeyId: z.string().optional()
});

export const aiUsageAnalyticsParams = z.object({
    orgId: z.string()
});

export const aiUsageAnalyticsCombined = aiUsageAnalyticsFiltersQuery.merge(
    aiUsageAnalyticsParams
);

export type AiUsageAnalyticsQuery = z.infer<typeof aiUsageAnalyticsCombined>;

// A role has no column on aiUsageRecords - it's derived by resolving the
// role's members to userIds first, then filtering on userId. If the role has
// no members we still need the filter to exclude everything rather than be
// silently ignored, hence the sentinel value.
export async function resolveRoleUserIds(
    orgId: string,
    roleId?: number
): Promise<string[] | undefined> {
    if (!roleId) {
        return undefined;
    }

    const rows = await db
        .select({ userId: userOrgRoles.userId })
        .from(userOrgRoles)
        .where(
            and(eq(userOrgRoles.orgId, orgId), eq(userOrgRoles.roleId, roleId))
        );

    return rows.length > 0
        ? rows.map((r) => r.userId)
        : ["__no_users_in_role__"];
}

export function buildAiUsageWhere(
    data: AiUsageAnalyticsQuery,
    roleUserIds?: string[]
) {
    return and(
        eq(aiUsageRecords.orgId, data.orgId),
        gte(aiUsageRecords.createdAt, data.timeStart),
        lte(aiUsageRecords.createdAt, data.timeEnd),
        data.providerId
            ? eq(aiUsageRecords.providerId, data.providerId)
            : undefined,
        data.model ? eq(aiUsageRecords.requestedModel, data.model) : undefined,
        data.resourceId
            ? or(
                  eq(aiUsageRecords.resourceId, data.resourceId),
                  eq(aiUsageRecords.siteResourceId, data.resourceId)
              )
            : undefined,
        data.userId ? eq(aiUsageRecords.userId, data.userId) : undefined,
        data.virtualApiKeyId
            ? eq(aiUsageRecords.virtualApiKeyId, data.virtualApiKeyId)
            : undefined,
        roleUserIds ? inArray(aiUsageRecords.userId, roleUserIds) : undefined
    );
}

// Buckets createdAt (epoch seconds) down to a per-day string, dialect-aware,
// same approach as the DATE_TRUNC/DATE branch in queryRequestAnalytics.ts.
export function dayBucketExpr() {
    return driver === "pg"
        ? sql<string>`DATE_TRUNC('day', TO_TIMESTAMP(${aiUsageRecords.createdAt}))`
        : sql<string>`DATE(${aiUsageRecords.createdAt}, 'unixepoch')`;
}

export type DailyMetricRow<K extends string> = {
    day: string;
    key: K;
    value: number;
};

// Ranks dimension keys by total value and returns the top N.
export function pickTopNKeys<K extends string>(
    totals: Map<K, number>,
    n: number = TOP_N
): K[] {
    return [...totals.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([key]) => key);
}

export interface DayValueRow {
    day: string;
    [seriesKey: string]: number | string;
}

// Collapses per-day, per-key rows into a per-day series object, folding
// anything outside `topKeys` into a shared "other" series.
export function bucketTopNPerDay<K extends string>(
    rows: DailyMetricRow<K>[],
    topKeys: K[]
): DayValueRow[] {
    const topSet = new Set<string>(topKeys);
    const byDay = new Map<string, Record<string, number>>();

    for (const row of rows) {
        const seriesKey = topSet.has(row.key) ? row.key : "other";
        const dayEntry = byDay.get(row.day) ?? {};
        dayEntry[seriesKey] = (dayEntry[seriesKey] ?? 0) + row.value;
        byDay.set(row.day, dayEntry);
    }

    return [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, values]) => ({ day, ...values }));
}
