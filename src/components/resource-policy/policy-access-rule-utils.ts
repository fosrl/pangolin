import type { PolicyRuleMatchType } from "./policy-access-rule-validation";

export type PolicyAccessRule = {
    ruleId: number;
    action: "ACCEPT" | "DROP" | "PASS";
    match: PolicyRuleMatchType;
    value: string;
    priority: number;
    enabled: boolean;
    new?: boolean;
    updated?: boolean;
    fromPolicy?: boolean;
};

export type EmptyRuleDraft = PolicyAccessRule & {
    new: true;
};

export function createEmptyRule(
    existingRules: Array<{ priority: number }>
): EmptyRuleDraft {
    const priority =
        existingRules.reduce(
            (acc, rule) => (rule.priority > acc ? rule.priority : acc),
            0
        ) + 1;

    return {
        ruleId: Date.now(),
        action: "ACCEPT",
        match: "PATH",
        value: "",
        priority,
        enabled: true,
        new: true
    };
}

export function prependEmptyRule(
    rules: PolicyAccessRule[]
): PolicyAccessRule[] {
    const newRule: EmptyRuleDraft = {
        ruleId: Date.now(),
        action: "ACCEPT",
        match: "PATH",
        value: "",
        priority: 1,
        enabled: true,
        new: true
    };

    const bumpedRules = rules.map((rule) => {
        if (rule.fromPolicy) {
            return rule;
        }

        const bumped = { ...rule, priority: rule.priority + 1 };
        if (rule.new) {
            return bumped;
        }
        return { ...bumped, updated: true };
    });

    return [newRule, ...bumpedRules];
}

export function sortPolicyRulesByPriority<T extends { priority: number }>(
    rules: T[]
): T[] {
    return [...rules].sort((a, b) => a.priority - b.priority);
}

export function sortPolicyRulesForResourceOverlay<
    T extends { priority: number; fromPolicy?: boolean }
>(rules: T[]): T[] {
    const resourceRules = rules
        .filter((rule) => !rule.fromPolicy)
        .sort((a, b) => a.priority - b.priority);
    const policyRules = rules
        .filter((rule) => rule.fromPolicy)
        .sort((a, b) => a.priority - b.priority);

    return [...resourceRules, ...policyRules];
}

export function buildDisplayPrioritiesForResourceOverlay<
    T extends { ruleId: number; priority: number; fromPolicy?: boolean }
>(rules: T[]): Map<number, number> {
    const sorted = sortPolicyRulesForResourceOverlay(rules);
    const displayPriorities = new Map<number, number>();

    sorted.forEach((rule, index) => {
        displayPriorities.set(rule.ruleId, index + 1);
    });

    return displayPriorities;
}

export function setResourceRuleDisplayPriority(
    rules: PolicyAccessRule[],
    ruleId: number,
    displayPriority: number,
    options?: { markUpdated?: boolean }
): PolicyAccessRule[] {
    const sorted = sortPolicyRulesForResourceOverlay(rules);
    const resourceRules = sorted.filter((rule) => !rule.fromPolicy);
    const policyRules = sorted.filter((rule) => rule.fromPolicy);

    const fromIndex = resourceRules.findIndex((rule) => rule.ruleId === ruleId);
    if (fromIndex === -1) {
        return rules;
    }

    const targetIndex = Math.max(
        0,
        Math.min(displayPriority - 1, resourceRules.length - 1)
    );

    const reorderedResource = reorderPolicyRules(
        resourceRules,
        fromIndex,
        targetIndex,
        options
    );

    return [...reorderedResource, ...policyRules];
}

export function reorderPolicyRules<
    T extends { priority: number; new?: boolean; updated?: boolean }
>(
    rules: T[],
    fromIndex: number,
    toIndex: number,
    options?: { markUpdated?: boolean }
): T[] {
    if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= rules.length ||
        toIndex >= rules.length
    ) {
        return rules;
    }

    const reordered = [...rules];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);

    return reordered.map((rule, index) => {
        const next = { ...rule, priority: index + 1 };
        if (options?.markUpdated && !rule.new) {
            return { ...next, updated: true };
        }
        return next;
    });
}

export function reorderResourceOverlayRules<
    T extends {
        ruleId: number;
        priority: number;
        fromPolicy?: boolean;
        new?: boolean;
        updated?: boolean;
    }
>(
    rules: T[],
    fromRuleId: number,
    toRuleId: number,
    options?: { markUpdated?: boolean }
): T[] {
    const sorted = sortPolicyRulesForResourceOverlay(rules);
    const resourceRules = sorted.filter((rule) => !rule.fromPolicy);
    const policyRules = sorted.filter((rule) => rule.fromPolicy);

    const fromIndex = resourceRules.findIndex(
        (rule) => rule.ruleId === fromRuleId
    );
    const toIndex = resourceRules.findIndex((rule) => rule.ruleId === toRuleId);

    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
        return rules;
    }

    const reorderedResource = reorderPolicyRules(
        resourceRules,
        fromIndex,
        toIndex,
        options
    );

    return [...reorderedResource, ...policyRules];
}
