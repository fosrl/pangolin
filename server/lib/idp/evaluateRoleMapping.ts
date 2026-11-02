import jmespath from "jmespath";
import { unwrapRoleMapping } from "@app/lib/idpRoleMapping";

/**
 * Evaluate a stored role mapping (raw JMESPath, fixed roles or the mapping builder)
 * against the claims and return the role names. Shared by JIT and directory sync.
 */
export function evaluateRoleMapping(
    roleMapping: string | null | undefined,
    claims: unknown
): string[] {
    const expression = unwrapRoleMapping(roleMapping).evaluationExpression;
    if (!expression) {
        return [];
    }
    return normalizeRoleMappingResult(jmespath.search(claims, expression));
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
