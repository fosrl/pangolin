/**
 * Build the Host()/HostRegexp() Traefik rule for a resource's domain.
 * Wildcard resources match any single subdomain via HostRegexp.
 */
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

/**
 * Append a path-matching clause to a Traefik rule based on the resource's
 * configured path and pathMatchType.
 */
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
 * Compute the router priority for a resource, favoring an explicit override
 * and otherwise deriving it from the path match specificity.
 */
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
