import { z } from "zod";

export const aiBudgetUnitSchema = z.enum(["usd", "tokens"]);

export const aiBudgetPeriodSchema = z.enum([
    "monthly",
    "yearly",
    "lifetime",
    "daily",
    "hourly",
    "weekly"
]);

export const aiBudgetEnforcementSchema = z.enum(["hard", "soft"]);

export function refineBudgetScopeFields(
    data: {
        providerId?: number | null;
        modelId?: number | null;
        resourceId?: number | null;
        siteResourceId?: number | null;
        roleId?: number | null;
        virtualApiKeyId?: string | null;
    },
    ctx: z.RefinementCtx
) {
    const scopeFields = [
        data.providerId,
        data.modelId,
        data.resourceId,
        data.siteResourceId,
        data.roleId,
        data.virtualApiKeyId
    ];

    const setCount = scopeFields.filter(
        (value) => value !== null && value !== undefined
    ).length;

    if (setCount > 1) {
        ctx.addIssue({
            code: "custom",
            message:
                "Only one of providerId, modelId, resourceId, siteResourceId, roleId, or virtualApiKeyId may be set on a budget",
            path: ["providerId"]
        });
    }
}
