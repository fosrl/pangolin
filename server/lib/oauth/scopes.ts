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

export function validateScopes(requested: string, allowed: string): string {
    const requestedScopes = parseScopeString(requested).filter(isOAuthScope);
    const allowedScopes = new Set(
        parseScopeString(allowed).filter(isOAuthScope)
    );

    const granted: string[] = [];

    for (const scope of requestedScopes) {
        if (scope === "openid") {
            if (!granted.includes("openid")) {
                granted.push("openid");
            }
            continue;
        }

        if (allowedScopes.has(scope) && !granted.includes(scope)) {
            granted.push(scope);
        }
    }

    return granted.join(" ");
}
