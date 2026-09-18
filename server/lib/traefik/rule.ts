// Build the Host()/HostRegexp() Traefik rule for a resource's domain.
// Wildcard resources match any single subdomain via HostRegexp.
export function buildHostRule(
    fullDomain: string,
    wildcard?: boolean | null
): string {
    if (wildcard && fullDomain.startsWith("*.")) {
        // Convert *.foo.bar.com -> HostRegexp(`^[^.]+\.foo\.bar\.com$`)
        const escaped = fullDomain.slice(2).replace(/\./g, "\\.");
        return `HostRegexp(\`^[^.]+\\.${escaped}$\`)`;
    }
    return `Host(\`${fullDomain}\`)`;
}

// Append a path-matching clause to a Traefik rule based on the resource's
// configured path and pathMatchType.
export function appendPathMatch(
    rule: string,
    path: string | null | undefined,
    pathMatchType: string | null | undefined
): string {
    if (!path || !pathMatchType) return rule;

    let p = path;
    if (!p.startsWith("/")) {
        p = `/${p}`;
    }

    if (pathMatchType === "exact") {
        return `${rule} && Path(\`${p}\`)`;
    } else if (pathMatchType === "prefix") {
        return `${rule} && PathPrefix(\`${p}\`)`;
    } else if (pathMatchType === "regex") {
        return `${rule} && PathRegexp(\`${path}\`)`; // this is the raw path because it's a regex
    }
    return rule;
}

/**
 * Server-side equivalent of the clause appendPathMatch emits, so badger can
 * tell whether a request would have matched a given path config. Mirrors
 * Traefik v3 semantics: Path is exact, PathPrefix is segment-aware
 * (`/products` matches `/products/shoes` but not `/productsforsale`), and
 * PathRegexp is an unanchored regex test.
 */
export function matchesPath(
    requestPath: string,
    path: string | null | undefined,
    pathMatchType: string | null | undefined
): boolean {
    if (!path || !pathMatchType) return true;

    if (pathMatchType === "regex") {
        try {
            return new RegExp(path).test(requestPath);
        } catch {
            return false;
        }
    }

    let p = path;
    if (!p.startsWith("/")) {
        p = `/${p}`;
    }

    if (pathMatchType === "exact") {
        return requestPath === p;
    } else if (pathMatchType === "prefix") {
        if (!requestPath.startsWith(p)) {
            return false;
        }
        if (p.endsWith("/")) {
            return true;
        }
        const rest = requestPath.slice(p.length);
        return rest === "" || rest.startsWith("/");
    }
    return true;
}

// Compute the router priority for a resource, favoring an explicit override
// and otherwise deriving it from the path match specificity.
export function computeRoutePriority(
    priority: number | null | undefined,
    path: string | null | undefined,
    pathMatchType: string | null | undefined
): number {
    if (priority && priority != 100) {
        return priority;
    }

    let p = 100;
    if (path && pathMatchType) {
        p += 10;
        if (pathMatchType === "exact") {
            p += 5;
        } else if (pathMatchType === "prefix") {
            p += 3;
        } else if (pathMatchType === "regex") {
            p += 2;
        }
        if (path === "/") {
            p = 1; // lowest for catch-all
        }
    }
    return p;
}

// Redirects must always be evaluated before resource routers on the same
// host. Target and redirect priorities are both capped at 1000, so lifting
// every redirect by this offset puts them in a band (1001-2000) no resource
// router can reach, while explicit priorities still order redirects among
// themselves.
export const REDIRECT_PRIORITY_OFFSET = 1000;

/**
 * Compute the router priority for a redirect: the same derivation as a
 * resource router, shifted into the redirect band.
 */
export function computeRedirectPriority(
    priority: number | null | undefined,
    path: string | null | undefined,
    pathMatchType: string | null | undefined
): number {
    return (
        computeRoutePriority(priority, path, pathMatchType) +
        REDIRECT_PRIORITY_OFFSET
    );
}
