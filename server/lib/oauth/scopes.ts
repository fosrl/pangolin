export const validScopes = ["openid", "profile", "email", "groups"] as const;

export type OAuthScope = (typeof validScopes)[number];

function isOAuthScope(scope: string): scope is OAuthScope {
    return (validScopes as readonly string[]).includes(scope);
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

export function isScopeSubset(candidateScope: string, originalScope: string): boolean {
    const original = new Set(parseScopeString(originalScope));
    return parseScopeString(candidateScope).every((scope) => original.has(scope));
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

    return Array.from(granted).join(" ");
}
