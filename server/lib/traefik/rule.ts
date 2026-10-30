// Characters that cannot appear inside a Go raw (backtick) string literal:
// the backtick itself would terminate it, and control characters are
// rejected by the scanner Traefik uses to parse rules.
const UNSAFE_RAW_RULE_VALUE = /[`\u0000-\u001f\u007f]/;

/**
 * Quote a value for use as a matcher argument in a Traefik rule.
 *
 * Every value interpolated into a rule must go through this. Rules are
 * parsed as Go expressions, so a value containing a backtick could otherwise
 * close its literal and inject arbitrary matchers (e.g. a Host() clause for
 * another org's domain). Ordinary values keep the conventional backtick form;
 * anything else is emitted as a double-quoted Go string literal, which
 * Traefik unquotes back to exactly the original value.
 */
export function ruleValue(value: string): string {
    if (!UNSAFE_RAW_RULE_VALUE.test(value)) {
        return `\`${value}\``;
    }
    // JSON string escapes are a subset of Go's interpreted string escapes.
    // Lone surrogates are replaced since Go rejects them in \u escapes.
    return JSON.stringify(value.toWellFormed());
}

// Build the Host()/HostRegexp() Traefik rule for a resource's domain.
// Wildcard resources match any single subdomain via HostRegexp, and the host
// the wildcard sits under too when matchBaseDomain is set. That stays a single
// matcher rather than an || so appended && clauses apply to both hosts.
export function buildHostRule(
    fullDomain: string,
    wildcard?: boolean | null,
    matchBaseDomain?: boolean | null
): string {
    if (wildcard && fullDomain.startsWith("*.")) {
        // Convert *.foo.bar.com -> HostRegexp(`^[^.]+\.foo\.bar\.com$`)
        const escaped = fullDomain.slice(2).replace(/\./g, "\\.");
        const label = matchBaseDomain ? "([^.]+\\.)?" : "[^.]+\\.";
        return `HostRegexp(${ruleValue(`^${label}${escaped}$`)})`;
    }
    return `Host(${ruleValue(fullDomain)})`;
}

/**
 * Pick the resource serving `host` from the rows that matched it. An exact
 * fullDomain wins, then the most specific wildcard, which is what Traefik
 * routes to when a broader wildcard also matches.
 */
export function pickResourceForHost<T>(
    rows: T[],
    host: string,
    getFullDomain: (row: T) => string | null | undefined
): T | undefined {
    const length = (row: T) => getFullDomain(row)?.length ?? 0;
    return (
        rows.find((row) => getFullDomain(row) === host) ??
        [...rows].sort((a, b) => length(b) - length(a))[0]
    );
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
        return `${rule} && Path(${ruleValue(p)})`;
    } else if (pathMatchType === "prefix") {
        return `${rule} && PathPrefix(${ruleValue(p)})`;
    } else if (pathMatchType === "regex") {
        return `${rule} && PathRegexp(${ruleValue(path)})`; // this is the raw path because it's a regex
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
