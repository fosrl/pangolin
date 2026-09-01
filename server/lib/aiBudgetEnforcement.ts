import {
    and,
    eq,
    gte,
    inArray,
    isNull,
    or,
    sql,
    SQL,
    type InferInsertModel
} from "drizzle-orm";
import {
    AiBudget,
    aiBudgetBreachEvents,
    aiBudgets,
    aiModels,
    aiUsageRecords,
    db,
    logsDb,
    userOrgRoles
} from "@server/db";
import { modelKeyMatches } from "@server/lib/aiModelKeyMatch";
import type { AiUsage } from "@server/lib/aiUsageExtraction";
import { regionalCache as cache } from "#dynamic/lib/cache";
import logger from "@server/logger";

type BudgetPeriod = AiBudget["period"];

const PERIOD_DURATIONS_MS: Record<Exclude<BudgetPeriod, "lifetime">, number> = {
    hourly: 60 * 60 * 1000,
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000,
    monthly: 30 * 24 * 60 * 60 * 1000,
    yearly: 365 * 24 * 60 * 60 * 1000
};

// Budgets are cheap to be a little stale about (enforcement is already
// check-then-act, not transactional). Re-derive each budget's usage sum
// from aiUsageRecords at most this often; in between, completed requests
// just add their own contribution onto the cached sum instead of
// re-querying/re-aggregating from scratch.
const BUDGET_CACHE_REFRESH_MS = 8_000;
// Redis-level TTL is only a safety net for eviction if a budget stops
// seeing traffic - the actual staleness check is the computedAt timestamp
// stored in the cached value, compared against BUDGET_CACHE_REFRESH_MS.
const BUDGET_CACHE_SAFETY_TTL_SEC = 60;

function applicableBudgetsCacheKey(ctx: BudgetScopeContext): string {
    const roleKey = [...ctx.roleIds].sort((a, b) => a - b).join(",");
    return [
        "aiBudget:applicable",
        ctx.orgId,
        ctx.providerId,
        ctx.requestedModel,
        ctx.resourceId ?? "",
        ctx.siteResourceId ?? "",
        roleKey,
        ctx.virtualApiKeyId ?? ""
    ].join(":");
}

function budgetUsageCacheKey(budgetId: number): string {
    return `aiBudget:usage:${budgetId}`;
}

type CachedBudgetUsage = {
    sum: number;
    computedAt: number;
};

// Budget periods are trailing windows from "now", not calendar-aligned
// (e.g. "daily" = last 24h). "lifetime" has no lower bound.
function windowStart(period: BudgetPeriod, now: number): number {
    if (period === "lifetime") {
        return 0;
    }
    return now - PERIOD_DURATIONS_MS[period];
}

export type BudgetScopeContext = {
    orgId: string;
    providerId: number;
    requestedModel: string;
    resourceId: number | null;
    siteResourceId: number | null;
    roleIds: number[];
    requestUserId: string | null;
    virtualApiKeyId: string | null;
};

/**
 * Every budget that could apply to this request: the provider itself, any
 * model on that provider whose (possibly wildcarded) modelKey matches the
 * requested model, the target resource/site-resource, and any role the
 * requesting user holds in the org. Cached for BUDGET_CACHE_REFRESH_MS since
 * budget/model config changes are rare and a request-scoped org/provider/
 * model/resource/role combination repeats constantly under real traffic.
 */
export async function resolveApplicableBudgets(
    ctx: BudgetScopeContext
): Promise<AiBudget[]> {
    const cacheKey = applicableBudgetsCacheKey(ctx);
    const cached = await cache.get<AiBudget[]>(cacheKey);
    if (cached !== undefined) {
        return cached;
    }

    const budgets = await fetchApplicableBudgets(ctx);
    await cache.set(cacheKey, budgets, BUDGET_CACHE_REFRESH_MS / 1000);
    return budgets;
}

async function fetchApplicableBudgets(
    ctx: BudgetScopeContext
): Promise<AiBudget[]> {
    const providerModels = await db
        .select({ modelId: aiModels.modelId, modelKey: aiModels.modelKey })
        .from(aiModels)
        .where(
            and(
                eq(aiModels.providerId, ctx.providerId),
                eq(aiModels.enabled, true)
            )
        );

    const matchingModelIds = providerModels
        .filter((m) => modelKeyMatches(m.modelKey, ctx.requestedModel))
        .map((m) => m.modelId);

    const scopeConditions: SQL[] = [
        and(
            eq(aiBudgets.providerId, ctx.providerId),
            isNull(aiBudgets.modelId)
        )!
    ];
    if (matchingModelIds.length > 0) {
        scopeConditions.push(inArray(aiBudgets.modelId, matchingModelIds));
    }
    if (ctx.resourceId != null) {
        scopeConditions.push(eq(aiBudgets.resourceId, ctx.resourceId));
    }
    if (ctx.siteResourceId != null) {
        scopeConditions.push(eq(aiBudgets.siteResourceId, ctx.siteResourceId));
    }
    if (ctx.roleIds.length > 0) {
        scopeConditions.push(inArray(aiBudgets.roleId, ctx.roleIds));
    }
    if (ctx.virtualApiKeyId != null) {
        scopeConditions.push(
            eq(aiBudgets.virtualApiKeyId, ctx.virtualApiKeyId)
        );
    }

    return db
        .select()
        .from(aiBudgets)
        .where(
            and(
                eq(aiBudgets.orgId, ctx.orgId),
                eq(aiBudgets.enabled, true),
                or(...scopeConditions)
            )
        );
}

async function sumUsageAmount(
    where: SQL,
    unit: AiBudget["unit"]
): Promise<number> {
    const column =
        unit === "usd" ? aiUsageRecords.costUsd : aiUsageRecords.totalTokens;
    const [row] = await logsDb
        .select({ total: sql<number>`coalesce(sum(${column}), 0)` })
        .from(aiUsageRecords)
        .where(where);
    return Number(row?.total ?? 0);
}

/**
 * Sums recorded usage for a single budget's scope + rolling window. Model
 * budgets can't be pushed down to SQL because the model's key may itself be
 * a glob, so those rows are fetched for the provider+window and matched in
 * JS the same way access-control matching does.
 */
export async function sumUsageForBudget(
    budget: AiBudget,
    ctx: BudgetScopeContext,
    now: number
): Promise<number> {
    const start = windowStart(budget.period, now);

    if (budget.modelId != null) {
        const [model] = await db
            .select({
                providerId: aiModels.providerId,
                modelKey: aiModels.modelKey
            })
            .from(aiModels)
            .where(eq(aiModels.modelId, budget.modelId))
            .limit(1);
        if (!model) {
            return 0;
        }
        const rows = await logsDb
            .select({
                requestedModel: aiUsageRecords.requestedModel,
                costUsd: aiUsageRecords.costUsd,
                totalTokens: aiUsageRecords.totalTokens
            })
            .from(aiUsageRecords)
            .where(
                and(
                    eq(aiUsageRecords.orgId, ctx.orgId),
                    eq(aiUsageRecords.providerId, model.providerId),
                    gte(aiUsageRecords.createdAt, start)
                )
            );
        return rows
            .filter((r) => modelKeyMatches(model.modelKey, r.requestedModel))
            .reduce(
                (sum, r) =>
                    sum +
                    (budget.unit === "usd" ? (r.costUsd ?? 0) : r.totalTokens),
                0
            );
    }

    if (budget.providerId != null) {
        return sumUsageAmount(
            and(
                eq(aiUsageRecords.orgId, ctx.orgId),
                eq(aiUsageRecords.providerId, budget.providerId),
                gte(aiUsageRecords.createdAt, start)
            )!,
            budget.unit
        );
    }

    if (budget.resourceId != null) {
        return sumUsageAmount(
            and(
                eq(aiUsageRecords.orgId, ctx.orgId),
                eq(aiUsageRecords.resourceId, budget.resourceId),
                gte(aiUsageRecords.createdAt, start)
            )!,
            budget.unit
        );
    }

    if (budget.siteResourceId != null) {
        return sumUsageAmount(
            and(
                eq(aiUsageRecords.orgId, ctx.orgId),
                eq(aiUsageRecords.siteResourceId, budget.siteResourceId),
                gte(aiUsageRecords.createdAt, start)
            )!,
            budget.unit
        );
    }

    if (budget.roleId != null) {
        const members = await db
            .select({ userId: userOrgRoles.userId })
            .from(userOrgRoles)
            .where(
                and(
                    eq(userOrgRoles.roleId, budget.roleId),
                    eq(userOrgRoles.orgId, ctx.orgId)
                )
            );
        const userIds = members.map((m) => m.userId);
        if (userIds.length === 0) {
            return 0;
        }
        return sumUsageAmount(
            and(
                eq(aiUsageRecords.orgId, ctx.orgId),
                inArray(aiUsageRecords.userId, userIds),
                gte(aiUsageRecords.createdAt, start)
            )!,
            budget.unit
        );
    }

    if (budget.virtualApiKeyId != null) {
        return sumUsageAmount(
            and(
                eq(aiUsageRecords.orgId, ctx.orgId),
                eq(aiUsageRecords.virtualApiKeyId, budget.virtualApiKeyId),
                gte(aiUsageRecords.createdAt, start)
            )!,
            budget.unit
        );
    }

    return 0;
}

/**
 * Cached wrapper around sumUsageForBudget. Reuses a per-budget cached sum
 * for up to BUDGET_CACHE_REFRESH_MS, and otherwise falls through to the DB
 * aggregation and reseeds the cache. Completed requests within that window
 * top the cached sum up via applyUsageToBudgetCache below rather than
 * forcing a re-aggregation on every request.
 */
async function getBudgetUsage(
    budget: AiBudget,
    ctx: BudgetScopeContext,
    now: number
): Promise<number> {
    const cacheKey = budgetUsageCacheKey(budget.budgetId);
    const cached = await cache.get<CachedBudgetUsage>(cacheKey);
    if (cached && now - cached.computedAt < BUDGET_CACHE_REFRESH_MS) {
        return cached.sum;
    }

    const sum = await sumUsageForBudget(budget, ctx, now);
    await cache.set(
        cacheKey,
        { sum, computedAt: now } satisfies CachedBudgetUsage,
        BUDGET_CACHE_SAFETY_TTL_SEC
    );
    return sum;
}

/**
 * Called once a request's actual usage is known, for every budget that was
 * resolved as applicable to it (i.e. checkBudgets' returned `budgets`).
 * Adds this request's contribution directly onto each budget's cached sum
 * so the next request in the same refresh window doesn't need to re-query
 * or re-aggregate. If there's no warm cache entry, or it's already due for
 * a refresh, this is a no-op - the next reader re-derives from the DB,
 * which by then already includes this request's row via recordUsage.
 */
export async function applyUsageToBudgetCache(
    budgets: AiBudget[],
    usage: { usd: number; tokens: number }
): Promise<void> {
    await Promise.all(
        budgets.map(async (budget) => {
            const delta = budget.unit === "usd" ? usage.usd : usage.tokens;
            if (!delta) {
                return;
            }

            const cacheKey = budgetUsageCacheKey(budget.budgetId);
            const cached = await cache.get<CachedBudgetUsage>(cacheKey);
            if (
                !cached ||
                Date.now() - cached.computedAt >= BUDGET_CACHE_REFRESH_MS
            ) {
                return;
            }

            await cache.set(
                cacheKey,
                {
                    sum: cached.sum + delta,
                    computedAt: cached.computedAt
                } satisfies CachedBudgetUsage,
                BUDGET_CACHE_SAFETY_TTL_SEC
            );
        })
    );
}

// Throttled to one durable event per budget per breach window, so a soft
// budget being exceeded doesn't write a row on every subsequent request
// while it stays over.
async function recordBreachEventIfNew(
    budget: AiBudget,
    ctx: BudgetScopeContext,
    usageAmount: number,
    now: number
): Promise<void> {
    try {
        const start = windowStart(budget.period, now);
        const [existing] = await db
            .select({ id: aiBudgetBreachEvents.id })
            .from(aiBudgetBreachEvents)
            .where(
                and(
                    eq(aiBudgetBreachEvents.budgetId, budget.budgetId),
                    gte(aiBudgetBreachEvents.createdAt, start)
                )
            )
            .limit(1);
        if (existing) {
            return;
        }

        await db.insert(aiBudgetBreachEvents).values({
            orgId: ctx.orgId,
            budgetId: budget.budgetId,
            enforcement: budget.enforcement,
            unit: budget.unit,
            period: budget.period,
            amount: budget.amount,
            usageAmount,
            blocked: budget.enforcement === "hard",
            requestUserId: ctx.requestUserId,
            createdAt: now
        });
    } catch (error) {
        logger.error("Failed to record AI budget breach event", {
            error,
            budgetId: budget.budgetId
        });
    }
}

export type BudgetCheckResult = {
    blocked: boolean;
    blockingBudget?: AiBudget;
    // Every budget resolved as applicable to this request, regardless of
    // whether it was breached - pass to applyUsageToBudgetCache once this
    // request's actual usage is known.
    budgets: AiBudget[];
};

export async function checkBudgets(
    ctx: BudgetScopeContext
): Promise<BudgetCheckResult> {
    const budgets = await resolveApplicableBudgets(ctx);
    if (budgets.length === 0) {
        return { blocked: false, budgets: [] };
    }

    const now = Date.now();
    let blockingBudget: AiBudget | undefined;

    for (const budget of budgets) {
        const usage = await getBudgetUsage(budget, ctx, now);
        if (usage < budget.amount) {
            continue;
        }

        await recordBreachEventIfNew(budget, ctx, usage, now);

        if (budget.enforcement === "hard" && !blockingBudget) {
            blockingBudget = budget;
        }
    }

    return blockingBudget
        ? { blocked: true, blockingBudget, budgets }
        : { blocked: false, budgets };
}

export type UsageRecordInput = {
    orgId: string;
    providerId: number;
    resourceId: number | null;
    siteResourceId: number | null;
    userId: string | null;
    virtualApiKeyId: string | null;
    requestedModel: string;
    usage: AiUsage;
    costUsd: number | null;
    createdAt?: number;
    // Same id as the aiSessionLog row logged for this request, so the two
    // can be joined to show token/cost usage alongside the session
    // transcript. Undefined when the session wasn't logged (e.g. session
    // log retention disabled for the org).
    sessionId?: string;
};

type AiUsageRecordInsert = InferInsertModel<typeof aiUsageRecords>;

// In-memory buffer for batching AI usage record inserts, mirroring the
// approach in server/routers/badger/logRequestAudit.ts. Usage rows are read
// back on every budget-cache miss (see getBudgetUsage above), which happens
// at least every BUDGET_CACHE_REFRESH_MS, so this buffer is flushed much
// more aggressively than the request audit log to keep the table from
// lagging behind what budget enforcement needs. Unlike the audit log, there
// is no retention/cleanup job for this table - usage history is kept
// indefinitely for billing and historical reporting.
const usageRecordBuffer: AiUsageRecordInsert[] = [];

const USAGE_BATCH_SIZE = 20; // Write to DB every 20 records
const USAGE_BATCH_INTERVAL_MS = 1000; // Or every 1 second, whichever comes first
const USAGE_MAX_BUFFER_SIZE = 5000; // Prevent unbounded memory growth
let usageFlushTimer: NodeJS.Timeout | null = null;
let isUsageFlushInProgress = false;

async function flushUsageRecords() {
    if (usageRecordBuffer.length === 0 || isUsageFlushInProgress) {
        return;
    }

    isUsageFlushInProgress = true;

    const recordsToWrite = usageRecordBuffer.splice(
        0,
        usageRecordBuffer.length
    );

    try {
        // Use a transaction to ensure all inserts succeed or fail together
        await logsDb.transaction(async (tx) => {
            // Batch insert in groups to avoid overwhelming the database
            const DB_BATCH_SIZE = 25;
            for (let i = 0; i < recordsToWrite.length; i += DB_BATCH_SIZE) {
                const batch = recordsToWrite.slice(i, i + DB_BATCH_SIZE);
                await tx.insert(aiUsageRecords).values(batch);
            }
        });
        logger.debug(
            `Flushed ${recordsToWrite.length} AI usage records to database`
        );
    } catch (error) {
        logger.error("Error flushing AI usage records:", error);
        // On transaction error, put records back at the front of the buffer
        // to retry, but only if the buffer isn't too large
        if (
            usageRecordBuffer.length <
            USAGE_MAX_BUFFER_SIZE - recordsToWrite.length
        ) {
            usageRecordBuffer.unshift(...recordsToWrite);
            logger.info(
                `Re-queued ${recordsToWrite.length} AI usage records for retry`
            );
        } else {
            logger.error(
                `Buffer full, dropped ${recordsToWrite.length} AI usage records`
            );
        }
    } finally {
        isUsageFlushInProgress = false;
        // If buffer filled up while we were flushing, flush again
        if (usageRecordBuffer.length >= USAGE_BATCH_SIZE) {
            flushUsageRecords().catch((err) =>
                logger.error("Error in follow-up AI usage flush:", err)
            );
        }
    }
}

function scheduleUsageFlush() {
    if (usageFlushTimer === null) {
        usageFlushTimer = setTimeout(() => {
            usageFlushTimer = null;
            flushUsageRecords().catch((err) =>
                logger.error("Error in scheduled AI usage flush:", err)
            );
        }, USAGE_BATCH_INTERVAL_MS);
    }
}

/**
 * Gracefully flush all pending AI usage records (call this on shutdown).
 */
export async function shutdownUsageRecorder() {
    if (usageFlushTimer) {
        clearTimeout(usageFlushTimer);
        usageFlushTimer = null;
    }
    // Force flush even if one is in progress by waiting and retrying
    while (isUsageFlushInProgress) {
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await flushUsageRecords();
}

export async function recordUsage(input: UsageRecordInput): Promise<void> {
    try {
        const { usage } = input;
        const totalTokens =
            usage.promptTokens +
            usage.cacheReadTokens +
            usage.cacheWriteTokens +
            usage.completionTokens +
            usage.reasoningTokens;

        // Prevent unbounded buffer growth - drop oldest entries if buffer is too large
        if (usageRecordBuffer.length >= USAGE_MAX_BUFFER_SIZE) {
            const dropped = usageRecordBuffer.splice(0, USAGE_BATCH_SIZE);
            logger.warn(
                `AI usage record buffer exceeded max size (${USAGE_MAX_BUFFER_SIZE}), dropped ${dropped.length} oldest entries`
            );
        }

        const timestamp = Math.floor(Date.now() / 1000);

        usageRecordBuffer.push({
            orgId: input.orgId,
            providerId: input.providerId,
            resourceId: input.resourceId,
            siteResourceId: input.siteResourceId,
            userId: input.userId,
            virtualApiKeyId: input.virtualApiKeyId,
            sessionId: input.sessionId,
            requestedModel: input.requestedModel,
            promptTokens: usage.promptTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheWriteTokens: usage.cacheWriteTokens,
            completionTokens: usage.completionTokens,
            reasoningTokens: usage.reasoningTokens,
            totalTokens,
            costUsd: input.costUsd,
            estimated: usage.estimated,
            createdAt: input.createdAt ?? timestamp
        });

        // Flush immediately if buffer is full, otherwise schedule a flush
        if (usageRecordBuffer.length >= USAGE_BATCH_SIZE) {
            flushUsageRecords().catch((err) =>
                logger.error("Error flushing AI usage records:", err)
            );
        } else {
            scheduleUsageFlush();
        }
    } catch (error) {
        logger.error("Failed to record AI usage", { error });
    }
}
