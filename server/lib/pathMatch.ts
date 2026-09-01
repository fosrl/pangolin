const MAX_RECURSION_DEPTH = 100;

const segmentRegexCache = new Map<string, RegExp>();

function getSegmentRegex(patternPart: string): RegExp {
    let regex = segmentRegexCache.get(patternPart);
    if (!regex) {
        const regexPattern = patternPart
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, ".*")
            .replace(/\?/g, ".");
        regex = new RegExp(`^${regexPattern}$`);
        segmentRegexCache.set(patternPart, regex);
    }
    return regex;
}

// Decodes percent-encoding (so an encoded slash like `%2F` is treated as a
// real path separator, matching what most backends will do) and then
// resolves `.` / `..` segments, so a request like `/public%2F..%2Fadmin/`
// or `/public/../admin/` is matched as `/admin/`, not as a literal segment
// or a wildcard-swallowed sequence under `/public/*`.
function decodeAndResolvePath(p: string): string[] {
    const rawParts = p.split("/").filter(Boolean);

    const resolved: string[] = [];
    for (const rawPart of rawParts) {
        let part: string;
        try {
            part = decodeURIComponent(rawPart);
        } catch {
            part = rawPart;
        }

        // an encoded slash can turn one raw segment into several real ones
        for (const segment of part.split("/").filter(Boolean)) {
            if (segment === ".") {
                continue;
            } else if (segment === "..") {
                resolved.pop();
            } else {
                resolved.push(segment);
            }
        }
    }

    return resolved;
}

export function isPathAllowed(pattern: string, path: string): boolean {
    const patternParts = pattern.split("/").filter(Boolean);
    const pathParts = decodeAndResolvePath(path);

    function matchSegments(
        patternIndex: number,
        pathIndex: number,
        depth: number = 0
    ): boolean {
        if (depth > MAX_RECURSION_DEPTH) {
            return false;
        }

        const currentPatternPart = patternParts[patternIndex];
        const currentPathPart = pathParts[pathIndex];

        if (patternIndex >= patternParts.length) {
            return pathIndex >= pathParts.length;
        }

        if (pathIndex >= pathParts.length) {
            return patternParts.slice(patternIndex).every((p) => p === "*");
        }

        if (currentPatternPart === "*") {
            if (matchSegments(patternIndex + 1, pathIndex, depth + 1)) {
                return true;
            }
            if (matchSegments(patternIndex, pathIndex + 1, depth + 1)) {
                return true;
            }
            return false;
        }

        if (currentPatternPart.includes("*")) {
            const regex = getSegmentRegex(currentPatternPart);

            if (regex.test(currentPathPart)) {
                return matchSegments(
                    patternIndex + 1,
                    pathIndex + 1,
                    depth + 1
                );
            }
            return false;
        }

        if (currentPatternPart !== currentPathPart) {
            return false;
        }

        return matchSegments(patternIndex + 1, pathIndex + 1, depth + 1);
    }

    return matchSegments(0, 0, 0);
}
