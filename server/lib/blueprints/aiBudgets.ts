import { eq } from "drizzle-orm";
import { aiBudgets, Transaction } from "@server/db";

export type BlueprintAiBudgetInput = {
    amount: number;
    unit: "usd" | "tokens";
    period:
        | "monthly"
        | "yearly"
        | "lifetime"
        | "daily"
        | "hourly"
        | "weekly";
    enforcement: "hard" | "soft";
    enabled: boolean;
};

type SyncAiBudgetsInput = {
    orgId: string;
    trx: Transaction;
    budgets: BlueprintAiBudgetInput[];
} & (
    | { scope: "public"; resourceId: number }
    | { scope: "site"; siteResourceId: number }
);

/**
 * Fully declarative: makes the resource's/site resource's AI budgets match
 * exactly what the blueprint declares (omitted unit/period budgets are removed).
 */
export async function syncAiBudgets(input: SyncAiBudgetsInput): Promise<void> {
    const { orgId, trx, budgets } = input;

    const existing = await trx
        .select()
        .from(aiBudgets)
        .where(
            input.scope === "public"
                ? eq(aiBudgets.resourceId, input.resourceId)
                : eq(aiBudgets.siteResourceId, input.siteResourceId)
        );

    const existingByKey = new Map(
        existing.map((b) => [`${b.unit}::${b.period}`, b])
    );

    const seenKeys = new Set<string>();
    const now = Date.now();

    for (const budget of budgets) {
        const key = `${budget.unit}::${budget.period}`;
        seenKeys.add(key);
        const existingBudget = existingByKey.get(key);

        if (existingBudget) {
            await trx
                .update(aiBudgets)
                .set({
                    amount: budget.amount,
                    enforcement: budget.enforcement,
                    enabled: budget.enabled,
                    updatedAt: now
                })
                .where(eq(aiBudgets.budgetId, existingBudget.budgetId));
        } else {
            await trx.insert(aiBudgets).values({
                orgId,
                resourceId: input.scope === "public" ? input.resourceId : null,
                siteResourceId:
                    input.scope === "site" ? input.siteResourceId : null,
                amount: budget.amount,
                unit: budget.unit,
                period: budget.period,
                enforcement: budget.enforcement,
                enabled: budget.enabled,
                createdAt: now,
                updatedAt: now
            });
        }
    }

    for (const [key, existingBudget] of existingByKey) {
        if (!seenKeys.has(key)) {
            await trx
                .delete(aiBudgets)
                .where(eq(aiBudgets.budgetId, existingBudget.budgetId));
        }
    }
}
