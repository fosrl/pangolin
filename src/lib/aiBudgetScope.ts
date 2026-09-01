import type { AiBudget } from "@server/db";

export type AiBudgetScopeType =
    | "provider"
    | "model"
    | "resource"
    | "siteResource"
    | "role"
    | "virtualApiKey";

export type AiBudgetScope = {
    type: AiBudgetScopeType;
    id: number | string;
};

export type AiBudgetScopeBodyField =
    | "providerId"
    | "modelId"
    | "resourceId"
    | "siteResourceId"
    | "roleId"
    | "virtualApiKeyId";

const scopeConfig: Record<
    AiBudgetScopeType,
    {
        listPath: (id: number | string) => string;
        bodyField: AiBudgetScopeBodyField;
    }
> = {
    provider: {
        listPath: (id) => `/ai-provider/${id}/ai-budgets`,
        bodyField: "providerId"
    },
    model: {
        listPath: (id) => `/ai-model/${id}/ai-budgets`,
        bodyField: "modelId"
    },
    resource: {
        listPath: (id) => `/resource/${id}/ai-budgets`,
        bodyField: "resourceId"
    },
    siteResource: {
        listPath: (id) => `/site-resource/${id}/ai-budgets`,
        bodyField: "siteResourceId"
    },
    role: {
        listPath: (id) => `/role/${id}/ai-budgets`,
        bodyField: "roleId"
    },
    virtualApiKey: {
        listPath: (id) => `/virtual-api-key/${id}/ai-budgets`,
        bodyField: "virtualApiKeyId"
    }
};

export function getAiBudgetScopeListPath(scope: AiBudgetScope): string {
    return scopeConfig[scope.type].listPath(scope.id);
}

export function getAiBudgetScopeBodyField(
    scope: AiBudgetScope
): AiBudgetScopeBodyField {
    return scopeConfig[scope.type].bodyField;
}

export type AiBudgetUnit = AiBudget["unit"];
export type AiBudgetPeriod = AiBudget["period"];

export const AI_BUDGET_UNITS: AiBudgetUnit[] = ["usd", "tokens"];

export const AI_BUDGET_PERIODS: AiBudgetPeriod[] = [
    "hourly",
    "daily",
    "weekly",
    "monthly",
    "yearly",
    "lifetime"
];
