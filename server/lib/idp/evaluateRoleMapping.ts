import { evaluateRoleMappingExpression } from "@app/lib/idpMappingEval";

export { normalizeRoleMappingResult } from "@app/lib/idpMappingEval";

/**
 * Evaluate a stored role mapping (raw JMESPath, fixed roles or the mapping builder)
 * against the claims and return the role names. Shared by JIT and directory sync.
 * Throws if the expression is invalid.
 */
export function evaluateRoleMapping(
    roleMapping: string | null | undefined,
    claims: unknown
): string[] {
    const evaluation = evaluateRoleMappingExpression(claims, roleMapping);
    if (evaluation?.error) {
        throw new Error(evaluation.error);
    }
    return evaluation?.roleNames ?? [];
}
