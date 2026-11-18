// Test child for aiBudgetEnforcement.test.ts. Boots the real sqlite driver
// against a fresh database in the temp workdir (cwd), writes usage through the
// real recordUsage buffer, runs the real budget queries, and prints one JSON
// line of observations.
// The app boots with `import "./extendZod"` before anything else; zod schemas
// in the import chain use .openapi(), so do the same here.
import "@server/extendZod";
import {
    aiBudgetBreachEvents,
    aiBudgets,
    aiModels,
    aiProviders,
    db,
    orgs,
    type AiBudget
} from "@server/db";
import {
    checkBudgets,
    recordUsage,
    shutdownUsageRecorder,
    sumUsageForBudget,
    type BudgetScopeContext
} from "@server/lib/aiBudgetEnforcement";
import { count, eq } from "drizzle-orm";

const ORG_ID = "org1";
const HOUR_SEC = 60 * 60;
const DAY_SEC = 24 * HOUR_SEC;

const now = Date.now();
const nowSec = Math.floor(now / 1000);

async function createProvider(niceId: string): Promise<number> {
    const [provider] = await db
        .insert(aiProviders)
        .values({
            orgId: ORG_ID,
            name: niceId,
            niceId,
            type: "custom",
            authType: "none",
            createdAt: nowSec,
            updatedAt: nowSec
        })
        .returning({ providerId: aiProviders.providerId });
    return provider.providerId;
}

async function createModel(
    providerId: number,
    modelKey: string
): Promise<number> {
    const [model] = await db
        .insert(aiModels)
        .values({
            providerId,
            modelKey,
            name: modelKey,
            createdAt: nowSec,
            updatedAt: nowSec
        })
        .returning({ modelId: aiModels.modelId });
    return model.modelId;
}

async function createBudget(
    scope: { providerId: number } | { modelId: number },
    period: AiBudget["period"],
    unit: AiBudget["unit"],
    amount: number,
    enforcement: AiBudget["enforcement"] = "hard"
): Promise<AiBudget> {
    const [budget] = await db
        .insert(aiBudgets)
        .values({
            orgId: ORG_ID,
            ...scope,
            amount,
            unit,
            period,
            enforcement,
            createdAt: nowSec,
            updatedAt: nowSec
        })
        .returning();
    return budget;
}

// Omitting ageSec leaves createdAt to recordUsage's own default, so the test
// covers the timestamp unit the production write path really stores.
function use(
    providerId: number,
    requestedModel: string,
    costUsd: number | null,
    tokens: number,
    ageSec?: number
): Promise<void> {
    return recordUsage({
        orgId: ORG_ID,
        providerId,
        resourceId: null,
        siteResourceId: null,
        userId: null,
        virtualApiKeyId: null,
        requestedModel,
        usage: {
            promptTokens: tokens,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            completionTokens: 0,
            reasoningTokens: 0,
            estimated: false
        },
        costUsd,
        createdAt: ageSec === undefined ? undefined : nowSec - ageSec
    });
}

function ctxFor(providerId: number): BudgetScopeContext {
    return {
        orgId: ORG_ID,
        providerId,
        requestedModel: "gpt-4o",
        resourceId: null,
        siteResourceId: null,
        roleIds: [],
        requestUserId: null,
        virtualApiKeyId: null
    };
}

async function breachCount(budgetId: number): Promise<number> {
    const [row] = await db
        .select({ count: count() })
        .from(aiBudgetBreachEvents)
        .where(eq(aiBudgetBreachEvents.budgetId, budgetId));
    return row.count;
}

async function main() {
    await db.insert(orgs).values({
        orgId: ORG_ID,
        name: "Org",
        settingsJitModeLimit: 1
    });

    const windows = await createProvider("windows");
    const gptWildcard = await createModel(windows, "gpt-*");
    const claudeExact = await createModel(windows, "claude-3");

    await use(windows, "gpt-4o", 1, 100);
    await use(windows, "gpt-4o-mini", 1, 100);
    await use(windows, "claude-3", 1, 100);
    await use(windows, "gpt-4o", null, 50); // unpriced request
    await use(windows, "gpt-4o", 4, 400, 2 * HOUR_SEC);
    await use(windows, "gpt-4o", 10, 1000, 2 * DAY_SEC);

    const boundary = await createProvider("boundary");
    await use(boundary, "gpt-4o", 1, 100, DAY_SEC); // exactly on the cutoff
    await use(boundary, "gpt-4o", 5, 500, DAY_SEC + 1); // just outside it

    const overHard = await createProvider("over-hard");
    await use(overHard, "gpt-4o", 3, 300);

    const underHard = await createProvider("under-hard");
    await use(underHard, "gpt-4o", 3, 300);

    const overSoft = await createProvider("over-soft");
    await use(overSoft, "gpt-4o", 3, 300);

    const expired = await createProvider("expired");
    await use(expired, "gpt-4o", 10, 1000, 2 * DAY_SEC);

    await shutdownUsageRecorder();

    const sum = async (budget: AiBudget) =>
        sumUsageForBudget(budget, ctxFor(windows), now);

    const overHardBudget = await createBudget(
        { providerId: overHard },
        "daily",
        "usd",
        2
    );
    await createBudget({ providerId: underHard }, "daily", "usd", 100);
    const overSoftBudget = await createBudget(
        { providerId: overSoft },
        "daily",
        "usd",
        2,
        "soft"
    );
    await createBudget({ providerId: expired }, "daily", "usd", 2);

    const firstCheck = await checkBudgets(ctxFor(overHard));
    // Still over budget: must block again without writing a second breach row.
    const secondCheck = await checkBudgets(ctxFor(overHard));
    const underCheck = await checkBudgets(ctxFor(underHard));
    const softCheck = await checkBudgets(ctxFor(overSoft));
    const expiredCheck = await checkBudgets(ctxFor(expired));

    const observations = {
        providerHourlyUsd: await sum(
            await createBudget({ providerId: windows }, "hourly", "usd", 1)
        ),
        providerDailyUsd: await sum(
            await createBudget({ providerId: windows }, "daily", "usd", 1)
        ),
        providerWeeklyUsd: await sum(
            await createBudget({ providerId: windows }, "weekly", "usd", 1)
        ),
        providerLifetimeUsd: await sum(
            await createBudget({ providerId: windows }, "lifetime", "usd", 1)
        ),
        providerDailyTokens: await sum(
            await createBudget({ providerId: windows }, "daily", "tokens", 1)
        ),
        wildcardHourlyUsd: await sum(
            await createBudget({ modelId: gptWildcard }, "hourly", "usd", 1)
        ),
        wildcardDailyUsd: await sum(
            await createBudget({ modelId: gptWildcard }, "daily", "usd", 1)
        ),
        wildcardDailyTokens: await sum(
            await createBudget({ modelId: gptWildcard }, "daily", "tokens", 1)
        ),
        exactModelDailyUsd: await sum(
            await createBudget({ modelId: claudeExact }, "daily", "usd", 1)
        ),
        boundaryDailyUsd: await sumUsageForBudget(
            await createBudget({ providerId: boundary }, "daily", "usd", 1),
            ctxFor(boundary),
            now
        ),
        overHardBlocked: firstCheck.blocked,
        overHardBlockingBudgetMatches:
            firstCheck.blockingBudget?.budgetId === overHardBudget.budgetId,
        overHardBlockedAgain: secondCheck.blocked,
        overHardBreachRows: await breachCount(overHardBudget.budgetId),
        underHardBlocked: underCheck.blocked,
        overSoftBlocked: softCheck.blocked,
        overSoftBreachRows: await breachCount(overSoftBudget.budgetId),
        expiredBlocked: expiredCheck.blocked
    };

    console.log("OBSERVATIONS " + JSON.stringify(observations));
}

main()
    .then(() => process.exit(0))
    .catch((e: any) => {
        console.error("CHILD_FAIL", e && e.message ? e.message : String(e));
        process.exit(1);
    });
