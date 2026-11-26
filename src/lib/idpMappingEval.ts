import jmespath from "jmespath";
import { unwrapRoleMapping } from "@app/lib/idpRoleMapping";

/**
 * Pure evaluation of IdP org/role mappings against token claims. Used by the
 * server (JIT login, directory sync, test login) and by the dashboard mapping
 * playground, so both always agree on what an expression returns.
 */

export type OrgMappingEvaluation = {
    /** Expression after `{{orgId}}` was replaced. */
    expression: string;
    result: unknown;
    /** The result is `true` or the orgId. */
    passed: boolean;
    error?: string;
};

export type RoleMappingEvaluation = {
    /** Expression passed to JMESPath (mapping builder wrapper removed). */
    expression: string;
    result: unknown;
    /** Normalized role names (strings, trimmed, de-duplicated). */
    roleNames: string[];
    error?: string;
};

export type MappingEvaluation = {
    /** `null` when there is no org mapping: every user passes. */
    orgMapping: OrgMappingEvaluation | null;
    /** `null` when there is no role mapping. */
    roleMapping: RoleMappingEvaluation | null;
};

export function hydrateOrgMapping(
    orgMapping: string | null | undefined,
    orgId: string
): string | undefined {
    if (!orgMapping) {
        return undefined;
    }
    return orgMapping.split("{{orgId}}").join(orgId);
}

export function normalizeRoleMappingResult(result: unknown): string[] {
    if (typeof result === "string") {
        const role = result.trim();
        return role ? [role] : [];
    }

    if (Array.isArray(result)) {
        return [
            ...new Set(
                result
                    .filter((value) => typeof value === "string")
                    .map((value) => value.trim())
                    .filter(Boolean)
            )
        ];
    }

    return [];
}

function errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

export function evaluateOrgMapping(
    claims: unknown,
    orgMapping: string | null | undefined,
    orgId: string
): OrgMappingEvaluation | null {
    const expression = hydrateOrgMapping(orgMapping, orgId);
    if (!expression) {
        return null;
    }
    try {
        const result = jmespath.search(claims, expression);
        return {
            expression,
            result,
            passed: result === true || result === orgId
        };
    } catch (e) {
        return {
            expression,
            result: null,
            passed: false,
            error: errorMessage(e)
        };
    }
}

export function evaluateRoleMappingExpression(
    claims: unknown,
    roleMapping: string | null | undefined
): RoleMappingEvaluation | null {
    const expression = unwrapRoleMapping(roleMapping).evaluationExpression;
    if (!expression) {
        return null;
    }
    try {
        const result = jmespath.search(claims, expression);
        return {
            expression,
            result,
            roleNames: normalizeRoleMappingResult(result)
        };
    } catch (e) {
        return {
            expression,
            result: null,
            roleNames: [],
            error: errorMessage(e)
        };
    }
}

/** Evaluates both mappings of one org. Never throws: errors are returned. */
export function evaluateMappings({
    claims,
    orgId,
    orgMapping,
    roleMapping
}: {
    claims: unknown;
    orgId: string;
    orgMapping: string | null | undefined;
    roleMapping: string | null | undefined;
}): MappingEvaluation {
    return {
        orgMapping: evaluateOrgMapping(claims, orgMapping, orgId),
        roleMapping: evaluateRoleMappingExpression(claims, roleMapping)
    };
}
