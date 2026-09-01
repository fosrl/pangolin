import { COUNTRIES } from "@server/db/countries";
import { isValidRegionId } from "@server/db/regions";
import {
    isValidCIDR,
    isValidIP,
    isValidUrlGlobPattern
} from "@server/lib/validators";
import z from "zod";

type TranslateFn = (
    key: string,
    values?: Record<string, string | number>
) => string;

export const POLICY_RULE_MATCH_TYPES = [
    "CIDR",
    "IP",
    "PATH",
    "COUNTRY",
    "COUNTRY_IS_NOT",
    "ASN",
    "REGION"
] as const;

export type PolicyRuleMatchType = (typeof POLICY_RULE_MATCH_TYPES)[number];

export function createPolicyRuleMatchSchema(t: TranslateFn) {
    return z.enum(POLICY_RULE_MATCH_TYPES, {
        error: t("rulesErrorInvalidMatchTypeDescription")
    });
}

export type RuleValidationToast = {
    title: string;
    description: string;
};

export function getPolicyRuleValidationMessage(
    t: TranslateFn,
    issue: z.core.$ZodIssue
): string {
    const ruleIndex = issue.path.find((segment) => typeof segment === "number");
    if (typeof ruleIndex === "number") {
        return t("rulesErrorValidationRuleDescription", {
            ruleNumber: ruleIndex + 1,
            message: issue.message
        });
    }
    return issue.message;
}

export function createPolicyRulePrioritySchema(t: TranslateFn) {
    return z.coerce
        .number({ error: t("rulesErrorInvalidPriorityDescription") })
        .int({ message: t("rulesErrorInvalidPriorityDescription") })
        .min(1, { message: t("rulesErrorInvalidPriorityDescription") });
}

export function createPolicyRuleValueSchema(t: TranslateFn, match: string) {
    const required = z
        .string()
        .min(1, { message: t("rulesErrorValueRequired") });

    switch (match) {
        case "CIDR":
            return required.refine(isValidCIDR, {
                message: t("rulesErrorInvalidIpAddressRangeDescription")
            });
        case "IP":
            return required.refine(isValidIP, {
                message: t("rulesErrorInvalidIpAddressDescription")
            });
        case "PATH":
            return required.refine(isValidUrlGlobPattern, {
                message: t("rulesErrorInvalidUrlDescription")
            });
        case "REGION":
            return required.refine(isValidRegionId, {
                message: t("rulesErrorInvalidRegionDescription")
            });
        case "COUNTRY":
        case "COUNTRY_IS_NOT":
            return required.refine(
                (value) => COUNTRIES.some((country) => country.code === value),
                { message: t("rulesErrorInvalidCountryDescription") }
            );
        case "ASN":
            return required.refine(
                (value) => {
                    const normalizedValue = value.trim().toUpperCase();
                    return (
                        /^AS\d+$/.test(normalizedValue) ||
                        normalizedValue === "ALL" ||
                        normalizedValue === "AS0"
                    );
                },
                {
                    message: t("rulesErrorInvalidAsnDescription")
                }
            );
        default:
            return required;
    }
}

export function createPolicyRuleSchema(t: TranslateFn) {
    return z
        .object({
            action: z.enum(["ACCEPT", "DROP", "PASS"]),
            match: createPolicyRuleMatchSchema(t),
            value: z.string(),
            priority: z.number().int(),
            enabled: z.boolean()
        })
        .superRefine((rule, ctx) => {
            const priorityResult = createPolicyRulePrioritySchema(t).safeParse(
                rule.priority
            );
            if (!priorityResult.success) {
                ctx.addIssue({
                    code: "custom",
                    message:
                        priorityResult.error.issues[0]?.message ??
                        t("rulesErrorInvalidPriorityDescription"),
                    path: ["priority"]
                });
            }

            const valueResult = createPolicyRuleValueSchema(
                t,
                rule.match
            ).safeParse(rule.value);
            if (!valueResult.success) {
                ctx.addIssue({
                    code: "custom",
                    message:
                        valueResult.error.issues[0]?.message ??
                        t("rulesErrorValueRequired"),
                    path: ["value"]
                });
            }
        });
}

export function createPolicyRulesArraySchema(t: TranslateFn) {
    return z.array(createPolicyRuleSchema(t)).superRefine((rules, ctx) => {
        const seenPriorities = new Set<number>();
        rules.forEach((rule, index) => {
            if (seenPriorities.has(rule.priority)) {
                ctx.addIssue({
                    code: "custom",
                    message: t("rulesErrorDuplicatePriorityDescription"),
                    path: [index, "priority"]
                });
            }
            seenPriorities.add(rule.priority);
        });
    });
}

export function createPolicyRulesSectionSchema(t: TranslateFn) {
    return z.object({
        applyRules: z.boolean(),
        rules: createPolicyRulesArraySchema(t)
    });
}

export function createPolicySchemaWithI18n(
    t: TranslateFn,
    baseSchema: z.ZodObject<z.ZodRawShape>
) {
    return baseSchema.extend({
        rules: createPolicyRulesArraySchema(t)
    });
}

export function validatePolicyRulePriority(
    t: TranslateFn,
    value: unknown
):
    | { success: true; data: number }
    | { success: false; toast: RuleValidationToast } {
    const result = createPolicyRulePrioritySchema(t).safeParse(value);
    if (result.success) {
        return { success: true, data: result.data };
    }

    return {
        success: false,
        toast: {
            title: t("rulesErrorInvalidPriority"),
            description:
                result.error.issues[0]?.message ??
                t("rulesErrorInvalidPriorityDescription")
        }
    };
}

export function validatePolicyRuleValue(
    t: TranslateFn,
    match: string,
    value: string
):
    | { success: true; data: string }
    | { success: false; toast: RuleValidationToast } {
    const result = createPolicyRuleValueSchema(t, match).safeParse(value);
    if (result.success) {
        return { success: true, data: result.data };
    }

    const issue = result.error.issues[0];
    const titleKey =
        match === "CIDR"
            ? "rulesErrorInvalidIpAddressRange"
            : match === "IP"
              ? "rulesErrorInvalidIpAddress"
              : match === "PATH"
                ? "rulesErrorInvalidUrl"
                : match === "REGION"
                  ? "rulesErrorInvalidRegion"
                  : match === "COUNTRY"
                    ? "rulesErrorInvalidCountry"
                    : match === "ASN"
                      ? "rulesErrorInvalidAsn"
                      : "rulesErrorValidation";

    return {
        success: false,
        toast: {
            title: t(titleKey),
            description: issue?.message ?? t("rulesErrorValueRequired")
        }
    };
}

export function validatePolicyRulesForSave(
    t: TranslateFn,
    rules: Array<{
        action: "ACCEPT" | "DROP" | "PASS";
        match: string;
        value: string;
        priority: number;
        enabled: boolean;
    }>,
    applyRules: boolean
): { success: true } | { success: false; toast: RuleValidationToast } {
    if (!applyRules) {
        return { success: true };
    }

    const result = createPolicyRulesArraySchema(t).safeParse(rules);
    if (result.success) {
        return { success: true };
    }

    const issue = result.error.issues[0];
    return {
        success: false,
        toast: {
            title: t("rulesErrorValidation"),
            description: issue
                ? getPolicyRuleValidationMessage(t, issue)
                : t("rulesErrorUpdateDescription")
        }
    };
}
