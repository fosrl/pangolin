// ─── Schemas & types ──────────────────────────────────────────────────────────

import z from "zod";
import { POLICY_RULE_MATCH_TYPES } from "./policy-access-rule-validation";
import type { PolicyRuleMatchType } from "./policy-access-rule-validation";

export const createPolicySchema = z.object({
    name: z.string().min(1).max(255),
    sso: z.boolean().default(true),
    skipToIdpId: z.number().nullable().optional(),
    emailWhitelistEnabled: z.boolean().default(false),
    roles: z.array(z.object({ id: z.string(), text: z.string() })),
    users: z.array(z.object({ id: z.string(), text: z.string() })),
    emails: z.array(z.object({ id: z.string(), text: z.string() })),
    password: z
        .object({
            password: z.string().min(4).max(100)
        })
        .nullable()
        .default(null),
    pincode: z
        .object({
            pincode: z.string().regex(/^\d{6}$/)
        })
        .nullable()
        .default(null),
    headerAuth: z
        .object({
            user: z.string().min(4).max(100),
            password: z.string().min(4).max(100),
            extendedCompatibility: z.boolean().default(true)
        })
        .nullable()
        .default(null),
    applyRules: z.boolean().default(false),
    rules: z
        .array(
            z.object({
                action: z.enum(["ACCEPT", "DROP", "PASS"]),
                match: z.enum(POLICY_RULE_MATCH_TYPES),
                value: z.string(),
                priority: z.number().int(),
                enabled: z.boolean()
            })
        )
        .default([])
});

export type PolicyFormValues = z.infer<typeof createPolicySchema>;

export type LocalRule = {
    ruleId: number;
    action: "ACCEPT" | "DROP" | "PASS";
    match: PolicyRuleMatchType;
    value: string;
    priority: number;
    enabled: boolean;
    new?: boolean;
    updated?: boolean;
};

export { PolicyAccessRulesTable } from "./PolicyAccessRulesTable";
export type { PolicyAccessRulesTableProps } from "./PolicyAccessRulesTable";
export {
    createEmptyRule,
    reorderPolicyRules,
    sortPolicyRulesByPriority,
    type EmptyRuleDraft,
    type PolicyAccessRule
} from "./policy-access-rule-utils";
export {
    createPolicyRuleMatchSchema,
    createPolicyRulePrioritySchema,
    createPolicyRuleSchema,
    createPolicyRuleValueSchema,
    createPolicyRulesArraySchema,
    createPolicyRulesSectionSchema,
    createPolicySchemaWithI18n,
    getPolicyRuleValidationMessage,
    POLICY_RULE_MATCH_TYPES,
    validatePolicyRulePriority,
    validatePolicyRuleValue,
    validatePolicyRulesForSave,
    type PolicyRuleMatchType,
    type RuleValidationToast
} from "./policy-access-rule-validation";
