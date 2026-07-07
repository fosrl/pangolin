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

export function isPathAllowed(pattern: string, path: string): boolean {
    const normalize = (p: string) => p.split("/").filter(Boolean);
    const patternParts = normalize(pattern);
    const pathParts = normalize(path);

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
