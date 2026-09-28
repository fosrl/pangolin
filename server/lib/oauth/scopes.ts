export const OFFLINE_ACCESS_SCOPE = "offline_access" as const;

export const VALID_SCOPES = [
    "openid",
    "profile",
    "email",
    "groups",
    OFFLINE_ACCESS_SCOPE
] as const;

export type OAuthScope = (typeof VALID_SCOPES)[number];
export const validScopes = new Set<OAuthScope>(VALID_SCOPES);

export function isOAuthScope(scope: string): scope is OAuthScope {
    return validScopes.has(scope as any);
}

export function buildScopeString(scopes: Iterable<string>) {
    return Array.from(scopes).join(" ");
}

export function parseScopeStringSet(scope: string): Set<string> {
    return new Set<string>(parseScopeString(scope));
}

export function parseScopeString(scope: string): string[] {
    return scope
        .split(" ")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

export function hasScope(scopeString: string, scope: OAuthScope): boolean {
    return parseScopeString(scopeString).includes(scope);
}

export function isScopeSubset(
    candidateScope: string,
    originalScope: string
): boolean {
    const original = parseScopeStringSet(originalScope);
    const candidate = parseScopeStringSet(candidateScope);
    return candidate.isSubsetOf(original);
}

export function validateScopes(requested: string, allowed: string): string {
    const allowedScopes = new Set(
        parseScopeString(allowed).filter(isOAuthScope)
    );
    const granted = new Set<string>();

    for (const scope of parseScopeString(requested).filter(isOAuthScope)) {
        if (allowedScopes.has(scope)) {
            granted.add(scope);
        }
    }

    return buildScopeString(granted);
}
