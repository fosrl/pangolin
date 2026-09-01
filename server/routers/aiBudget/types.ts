import type { AiBudget } from "@server/db";
import type { PaginatedResponse } from "@server/types/Pagination";

export type ListAiBudgetsResponse = PaginatedResponse<{
    budgets: AiBudget[];
}>;

export type ListAiBudgetsByScopeResponse = {
    budgets: AiBudget[];
};

export type GetAiBudgetResponse = {
    budget: AiBudget;
};

export type CreateOrEditAiBudgetResponse = {
    budget: AiBudget;
};
