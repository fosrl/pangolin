const modelKeyRegexCache = new Map<string, RegExp>();

export function isModelKeyPattern(key: string): boolean {
    return key.includes("*") || key.includes("?");
}

function getModelKeyRegex(pattern: string): RegExp {
    let regex = modelKeyRegexCache.get(pattern);
    if (!regex) {
        const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        regex = new RegExp(
            `^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`
        );
        modelKeyRegexCache.set(pattern, regex);
    }
    return regex;
}

export function modelKeyMatches(
    pattern: string,
    requestedModel: string
): boolean {
    return getModelKeyRegex(pattern).test(requestedModel);
}

function wildcardCharCount(key: string): number {
    let count = 0;
    for (const char of key) {
        if (char === "*" || char === "?") {
            count += 1;
        }
    }
    return count;
}

function literalLength(key: string): number {
    return key.replace(/[*?]/g, "").length;
}

/**
 * Sort comparator: more specific patterns sort before less specific ones
 * (negative when `a` is more specific than `b`).
 *
 * 1. Exact keys beat patterns
 * 2. Fewer wildcard characters win
 * 3. Longer literal length wins
 */
export function compareModelKeySpecificity(a: string, b: string): number {
    const aIsPattern = isModelKeyPattern(a);
    const bIsPattern = isModelKeyPattern(b);

    if (aIsPattern !== bIsPattern) {
        return aIsPattern ? 1 : -1;
    }

    const wildcardDiff = wildcardCharCount(a) - wildcardCharCount(b);
    if (wildcardDiff !== 0) {
        return wildcardDiff;
    }

    return literalLength(b) - literalLength(a);
}

/**
 * Provider-layer policy: empty allowlist denies all. Blocklist only applies
 * after an allow match.
 */
export function isAllowedByLists(
    requested: string,
    allows: string[],
    blocks: string[]
): boolean {
    if (allows.length === 0) {
        return false;
    }
    if (!allows.some((pattern) => modelKeyMatches(pattern, requested))) {
        return false;
    }
    if (blocks.some((pattern) => modelKeyMatches(pattern, requested))) {
        return false;
    }
    return true;
}

/**
 * Among allow patterns that match `requested`, return the most specific one,
 * or null if none match.
 */
export function mostSpecificMatchingAllow(
    requested: string,
    allows: string[]
): string | null {
    const matching = allows.filter((pattern) =>
        modelKeyMatches(pattern, requested)
    );
    if (matching.length === 0) {
        return null;
    }
    matching.sort(compareModelKeySpecificity);
    return matching[0];
}
