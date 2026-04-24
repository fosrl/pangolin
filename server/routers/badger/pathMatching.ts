import logger from "@server/logger";

export function isPathAllowed(
    pattern: string,
    path: string,
    query?: Record<string, string>
): boolean {
    logger.debug(`\nMatching path "${path}" against pattern "${pattern}"`);

    const patternQueryIndex = pattern.indexOf("?");
    const patternPathPart =
        patternQueryIndex !== -1
            ? pattern.slice(0, patternQueryIndex)
            : pattern;
    const patternQueryPart =
        patternQueryIndex !== -1 ? pattern.slice(patternQueryIndex + 1) : null;

    if (!matchPathPart(patternPathPart, path)) {
        return false;
    }

    if (patternQueryPart === null) {
        return true;
    }

    logger.debug(
        `Matching query params against pattern query "${patternQueryPart}"`
    );

    return matchQueryString(patternQueryPart, query);
}

function matchQueryString(
    patternQuery: string,
    query?: Record<string, string>
): boolean {
    if (patternQuery === "" || patternQuery === "*") {
        return true;
    }

    const patternParams = patternQuery.split("&").map((p) => {
        const eqIdx = p.indexOf("=");
        if (eqIdx === -1) return { key: p, value: null as string | null };
        return { key: p.slice(0, eqIdx), value: p.slice(eqIdx + 1) };
    });

    for (const { key, value } of patternParams) {
        const decodedKey = decodeURIComponent(key);
        const requestValue = query?.[decodedKey];

        if (requestValue === undefined) {
            logger.debug(`Query param "${decodedKey}" not found in request`);
            return false;
        }

        if (value !== null) {
            const decodedPatternValue = decodeURIComponent(value);
            if (!matchGlobValue(decodedPatternValue, requestValue)) {
                logger.debug(
                    `Query param "${decodedKey}" value "${requestValue}" doesn't match pattern "${decodedPatternValue}"`
                );
                return false;
            }
        }
    }

    return true;
}

function matchGlobValue(pattern: string, value: string): boolean {
    if (pattern === "*") return true;
    if (!pattern.includes("*")) return pattern === value;

    const regexPattern = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");
    return new RegExp(`^${regexPattern}$`).test(value);
}

function matchPathPart(pattern: string, path: string): boolean {
    const normalize = (p: string) => p.split("/").filter(Boolean);
    const patternParts = normalize(pattern);
    const pathParts = normalize(path);

    logger.debug(`Normalized pattern parts: [${patternParts.join(", ")}]`);
    logger.debug(`Normalized path parts: [${pathParts.join(", ")}]`);

    const MAX_RECURSION_DEPTH = 100;

    function matchSegments(
        patternIndex: number,
        pathIndex: number,
        depth: number = 0
    ): boolean {
        if (depth > MAX_RECURSION_DEPTH) {
            logger.warn(
                `Path matching exceeded maximum recursion depth (${MAX_RECURSION_DEPTH}) for pattern "${pattern}" and path "${path}"`
            );
            return false;
        }

        const indent = "  ".repeat(depth);
        const currentPatternPart = patternParts[patternIndex];
        const currentPathPart = pathParts[pathIndex];

        logger.debug(
            `${indent}Checking patternIndex=${patternIndex} (${currentPatternPart || "END"}) vs pathIndex=${pathIndex} (${currentPathPart || "END"}) [depth=${depth}]`
        );

        if (patternIndex >= patternParts.length) {
            const result = pathIndex >= pathParts.length;
            logger.debug(
                `${indent}Reached end of pattern, remaining path: ${pathParts.slice(pathIndex).join("/")} -> ${result}`
            );
            return result;
        }

        if (pathIndex >= pathParts.length) {
            const remainingPattern = patternParts.slice(patternIndex);
            const result = remainingPattern.every((p) => p === "*");
            logger.debug(
                `${indent}Reached end of path, remaining pattern: ${remainingPattern.join("/")} -> ${result}`
            );
            return result;
        }

        if (currentPatternPart === "*") {
            logger.debug(
                `${indent}Found wildcard at pattern index ${patternIndex}`
            );
            if (matchSegments(patternIndex + 1, pathIndex, depth + 1)) {
                return true;
            }
            if (matchSegments(patternIndex, pathIndex + 1, depth + 1)) {
                return true;
            }
            return false;
        }

        if (currentPatternPart.includes("*")) {
            const regexPattern = currentPatternPart.replace(/\*/g, ".*");
            const regex = new RegExp(`^${regexPattern}$`);

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

    const result = matchSegments(0, 0, 0);
    logger.debug(`Final result: ${result}`);
    return result;
}
