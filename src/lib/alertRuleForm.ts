import type { Tag } from "@app/components/tags/tag-input";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared primitive schemas
// ---------------------------------------------------------------------------

export const tagSchema = z.object({
    id: z.string(),
    text: z.string()
});

// ---------------------------------------------------------------------------
// Form-layer types
// NOTE: the form uses "health_check_unhealthy" internally; it maps to the
//       backend's "health_check_unhealthy" at the API boundary.
// ---------------------------------------------------------------------------

export type AlertTrigger =
    | "site_online"
    | "site_offline"
    | "site_toggle"
    | "health_check_healthy"
    | "health_check_unhealthy"
    | "health_check_toggle"
    | "resource_healthy"
    | "resource_unhealthy"
    | "resource_degraded"
    | "resource_toggle";

export type AlertRuleFormAction =
    | {
          type: "notify";
          userTags: Tag[];
          roleTags: Tag[];
          emailTags: Tag[];
      }
    | {
          type: "webhook";
          url: string;
          method: string;
          headers: { key: string; value: string }[];
          authType: "none" | "bearer" | "basic" | "custom";
          bearerToken: string;
          basicCredentials: string;
          customHeaderName: string;
          customHeaderValue: string;
          useBodyTemplate: boolean;
          bodyTemplate: string;
      };

export type AlertRuleFormValues = {
    name: string;
    enabled: boolean;
    cooldownSeconds: number;
    sourceType: "site" | "health_check" | "resource";
    allSites: boolean;
    siteIds: number[];
    allHealthChecks: boolean;
    healthCheckIds: number[];
    allResources: boolean;
    resourceIds: number[];
    /** Match any source of the selected kind carrying one of these labels */
    labelIds: number[];
    trigger: AlertTrigger;
    actions: AlertRuleFormAction[];
};

// ---------------------------------------------------------------------------
// API boundary types
// ---------------------------------------------------------------------------

export type AlertRuleApiPayload = {
    name: string;
    cooldownSeconds: number;
    eventType:
        | "site_online"
        | "site_offline"
        | "site_toggle"
        | "health_check_healthy"
        | "health_check_unhealthy"
        | "health_check_toggle"
        | "resource_healthy"
        | "resource_unhealthy"
        | "resource_degraded"
        | "resource_toggle";
    enabled: boolean;
    allSites: boolean;
    siteIds: number[];
    allHealthChecks: boolean;
    healthCheckIds: number[];
    allResources: boolean;
    resourceIds: number[];
    labelIds: number[];
    userIds: string[];
    roleIds: number[];
    emails: string[];
    webhookActions: {
        webhookUrl: string;
        enabled: boolean;
        config?: string;
    }[];
};

// Shape of what GET /org/:orgId/alert-rule/:alertRuleId returns
export type AlertRuleApiResponse = {
    alertRuleId: number;
    orgId: string;
    name: string;
    eventType: string;
    enabled: boolean;
    cooldownSeconds: number;
    lastTriggeredAt: number | null;
    createdAt: number;
    updatedAt: number;
    allSites: boolean;
    allHealthChecks: boolean;
    allResources: boolean;
    siteIds: number[];
    healthCheckIds: number[];
    resourceIds: number[];
    labelIds: number[];
    recipients: {
        recipientId: number;
        userId: string | null;
        roleId: number | null;
        email: string | null;
    }[];
    webhookActions: {
        webhookActionId: number;
        webhookUrl: string;
        enabled: boolean;
        lastSentAt: number | null;
        config: {
            authType: string;
            bearerToken?: string;
            basicCredentials?: string;
            customHeaderName?: string;
            customHeaderValue?: string;
            headers?: { key: string; value: string }[];
            method?: string;
            useBodyTemplate?: boolean;
            bodyTemplate?: string;
        } | null;
    }[];
};

// ---------------------------------------------------------------------------
// Zod form schema (for react-hook-form validation)
// ---------------------------------------------------------------------------

export function buildFormSchema(t: (k: string) => string) {
    return z
        .object({
            name: z
                .string()
                .min(1, { message: t("alertingErrorNameRequired") }),
            enabled: z.boolean(),
            cooldownSeconds: z.number().int().nonnegative().default(0),
            sourceType: z.enum(["site", "health_check", "resource"]),
            allSites: z.boolean().default(true),
            siteIds: z.array(z.number()).default([]),
            allHealthChecks: z.boolean().default(true),
            healthCheckIds: z.array(z.number()).default([]),
            allResources: z.boolean().default(true),
            resourceIds: z.array(z.number()).default([]),
            labelIds: z.array(z.number()).default([]),
            trigger: z.enum([
                "site_online",
                "site_offline",
                "site_toggle",
                "health_check_healthy",
                "health_check_unhealthy",
                "health_check_toggle",
                "resource_healthy",
                "resource_unhealthy",
                "resource_degraded",
                "resource_toggle"
            ]),
            actions: z.array(
                z.discriminatedUnion("type", [
                    z.object({
                        type: z.literal("notify"),
                        userTags: z.array(tagSchema),
                        roleTags: z.array(tagSchema),
                        emailTags: z.array(tagSchema)
                    }),
                    z.object({
                        type: z.literal("webhook"),
                        url: z.string(),
                        method: z.string(),
                        headers: z.array(
                            z.object({
                                key: z.string(),
                                value: z.string()
                            })
                        ),
                        authType: z.enum(["none", "bearer", "basic", "custom"]),
                        bearerToken: z.string(),
                        basicCredentials: z.string(),
                        customHeaderName: z.string(),
                        customHeaderValue: z.string(),
                        useBodyTemplate: z.boolean().default(false),
                        bodyTemplate: z.string().default("")
                    })
                ])
            )
        })
        .superRefine((val, ctx) => {
            if (val.actions.length === 0) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: t("alertingErrorActionsMin"),
                    path: ["actions"]
                });
            }
            const hasLabels = val.labelIds.length > 0;
            if (
                val.sourceType === "site" &&
                !val.allSites &&
                val.siteIds.length === 0 &&
                !hasLabels
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: t("alertingErrorPickSites"),
                    path: ["siteIds"]
                });
            }
            if (
                val.sourceType === "health_check" &&
                !val.allHealthChecks &&
                val.healthCheckIds.length === 0 &&
                !hasLabels
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: t("alertingErrorPickHealthChecks"),
                    path: ["healthCheckIds"]
                });
            }
            if (
                val.sourceType === "resource" &&
                !val.allResources &&
                val.resourceIds.length === 0 &&
                !hasLabels
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: t("alertingErrorPickResources"),
                    path: ["resourceIds"]
                });
            }
            const siteTriggers: AlertTrigger[] = [
                "site_online",
                "site_offline",
                "site_toggle"
            ];
            const hcTriggers: AlertTrigger[] = [
                "health_check_healthy",
                "health_check_unhealthy",
                "health_check_toggle"
            ];
            const resourceTriggers: AlertTrigger[] = [
                "resource_healthy",
                "resource_unhealthy",
                "resource_degraded",
                "resource_toggle"
            ];
            if (
                val.sourceType === "site" &&
                !siteTriggers.includes(val.trigger)
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: t("alertingErrorTriggerSite"),
                    path: ["trigger"]
                });
            }
            if (
                val.sourceType === "health_check" &&
                !hcTriggers.includes(val.trigger)
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: t("alertingErrorTriggerHealth"),
                    path: ["trigger"]
                });
            }
            if (
                val.sourceType === "resource" &&
                !resourceTriggers.includes(val.trigger)
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: t("alertingErrorTriggerResource"),
                    path: ["trigger"]
                });
            }
            val.actions.forEach((a, i) => {
                if (a.type === "notify") {
                    if (
                        a.userTags.length === 0 &&
                        a.roleTags.length === 0 &&
                        a.emailTags.length === 0
                    ) {
                        ctx.addIssue({
                            code: z.ZodIssueCode.custom,
                            message: t("alertingErrorNotifyRecipients"),
                            path: ["actions", i, "userTags"]
                        });
                    }
                }
                if (a.type === "webhook") {
                    try {
                        new URL(a.url.trim());
                    } catch {
                        ctx.addIssue({
                            code: z.ZodIssueCode.custom,
                            message: t("alertingErrorWebhookUrl"),
                            path: ["actions", i, "url"]
                        });
                    }
                }
            });
        });
}

// ---------------------------------------------------------------------------
// defaultFormValues
// ---------------------------------------------------------------------------

export function defaultFormValues(): AlertRuleFormValues {
    return {
        name: "",
        enabled: true,
        cooldownSeconds: 0,
        sourceType: "site",
        allSites: true,
        siteIds: [],
        allHealthChecks: true,
        healthCheckIds: [],
        allResources: true,
        resourceIds: [],
        labelIds: [],
        trigger: "site_toggle",
        actions: []
    };
}

// ---------------------------------------------------------------------------
// List/API row semantics
// ---------------------------------------------------------------------------

type AlertRuleScope = {
    eventType: string;
    allSites: boolean;
    allHealthChecks: boolean;
    allResources: boolean;
};

export function alertRuleSourceType(
    eventType: string
): AlertRuleFormValues["sourceType"] {
    if (eventType.startsWith("site_")) return "site";
    if (eventType.startsWith("resource_")) return "resource";
    return "health_check";
}

/** True when the rule matches every source of its event's kind. */
export function alertRuleMatchesAllSources(rule: AlertRuleScope): boolean {
    switch (alertRuleSourceType(rule.eventType)) {
        case "site":
            return rule.allSites;
        case "resource":
            return rule.allResources;
        default:
            return rule.allHealthChecks;
    }
}

// ---------------------------------------------------------------------------
// API response → form values
// ---------------------------------------------------------------------------

export function apiResponseToFormValues(
    rule: AlertRuleApiResponse
): AlertRuleFormValues {
    const trigger = rule.eventType;
    const sourceType = alertRuleSourceType(rule.eventType);

    // Collect notify recipients into a single notify action (if any)
    const userTags = rule.recipients
        .filter((r) => r.userId != null)
        .map((r) => ({ id: r.userId!, text: r.userId! }));
    const roleTags = rule.recipients
        .filter((r) => r.roleId != null)
        .map((r) => ({ id: String(r.roleId!), text: String(r.roleId!) }));
    const emailTags = rule.recipients
        .filter((r) => r.email != null)
        .map((r) => ({ id: r.email!, text: r.email! }));

    const actions: AlertRuleFormAction[] = [];

    if (userTags.length > 0 || roleTags.length > 0 || emailTags.length > 0) {
        actions.push({ type: "notify", userTags, roleTags, emailTags });
    }

    // Each webhook action becomes its own form webhook action
    for (const w of rule.webhookActions) {
        const cfg = w.config;
        actions.push({
            type: "webhook",
            url: w.webhookUrl,
            method: cfg?.method ?? "POST",
            headers: cfg?.headers?.length
                ? cfg.headers
                : [{ key: "", value: "" }],
            authType:
                (cfg?.authType as "none" | "bearer" | "basic" | "custom") ??
                "none",
            bearerToken: cfg?.bearerToken ?? "",
            basicCredentials: cfg?.basicCredentials ?? "",
            customHeaderName: cfg?.customHeaderName ?? "",
            customHeaderValue: cfg?.customHeaderValue ?? "",
            useBodyTemplate: cfg?.useBodyTemplate ?? false,
            bodyTemplate: cfg?.bodyTemplate ?? ""
        });
    }

    // Only the flag for the rule's own source kind is meaningful; the others
    // default to true so switching source type in the editor starts at "all".
    const matchesAll = alertRuleMatchesAllSources(rule);
    const allSites = sourceType === "site" ? matchesAll : true;
    const allHealthChecks = sourceType === "health_check" ? matchesAll : true;
    const allResources = sourceType === "resource" ? matchesAll : true;

    return {
        name: rule.name,
        enabled: rule.enabled,
        cooldownSeconds: rule.cooldownSeconds ?? 0,
        sourceType,
        allSites,
        siteIds: rule.siteIds,
        allHealthChecks,
        healthCheckIds: rule.healthCheckIds,
        allResources,
        resourceIds: rule.resourceIds ?? [],
        labelIds: matchesAll ? [] : (rule.labelIds ?? []),
        trigger: trigger as AlertTrigger,
        actions
    };
}

// ---------------------------------------------------------------------------
// Form values → API payload
// ---------------------------------------------------------------------------

export function formValuesToApiPayload(
    values: AlertRuleFormValues
): AlertRuleApiPayload {
    const eventType = values.trigger;

    // Collect all notify-type actions and merge their recipient lists
    const allUserIds: string[] = [];
    const allRoleIds: number[] = [];
    const allEmails: string[] = [];

    const webhookActions: AlertRuleApiPayload["webhookActions"] = [];

    for (const action of values.actions) {
        if (action.type === "notify") {
            allUserIds.push(...action.userTags.map((t) => t.id));
            allRoleIds.push(...action.roleTags.map((t) => Number(t.id)));
            allEmails.push(
                ...action.emailTags.map((t) => t.text.trim()).filter(Boolean)
            );
        } else if (action.type === "webhook") {
            webhookActions.push({
                webhookUrl: action.url.trim(),
                enabled: true,
                config: JSON.stringify({
                    authType: action.authType,
                    bearerToken: action.bearerToken || undefined,
                    basicCredentials: action.basicCredentials || undefined,
                    customHeaderName: action.customHeaderName || undefined,
                    customHeaderValue: action.customHeaderValue || undefined,
                    headers: action.headers.filter((h) => h.key.trim()),
                    method: action.method,
                    useBodyTemplate: action.useBodyTemplate || undefined,
                    bodyTemplate: action.useBodyTemplate
                        ? action.bodyTemplate || undefined
                        : undefined
                })
            });
        }
    }

    // Deduplicate
    const uniqueUserIds = [...new Set(allUserIds)];
    const uniqueRoleIds: number[] = [...new Set(allRoleIds)];
    const uniqueEmails = [...new Set(allEmails)];

    return {
        name: values.name.trim(),
        eventType,
        enabled: values.enabled,
        cooldownSeconds: values.cooldownSeconds,
        allSites: values.allSites,
        siteIds: values.allSites ? [] : values.siteIds,
        allHealthChecks: values.allHealthChecks,
        healthCheckIds: values.allHealthChecks ? [] : values.healthCheckIds,
        allResources: values.allResources,
        resourceIds: values.allResources ? [] : values.resourceIds,
        labelIds: alertRuleMatchesAllSources({ ...values, eventType })
            ? []
            : values.labelIds,
        userIds: uniqueUserIds,
        roleIds: uniqueRoleIds,
        emails: uniqueEmails,
        webhookActions
    };
}
