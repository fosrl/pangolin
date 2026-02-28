export const validScopes = ["openid", "profile", "email", "groups"] as const;

export type OAuthScope = (typeof validScopes)[number];

export const scopeDescriptions: Record<OAuthScope, string> = {
    openid: "Authenticate with your Pangolin account",
    profile: "Access your basic profile information",
    email: "Access your email address and verification status",
    groups: "Access your organization and role memberships"
};

function isOAuthScope(scope: string): scope is OAuthScope {
    return (
        scope === "openid" ||
        scope === "profile" ||
        scope === "email" ||
        scope === "groups"
    );
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
