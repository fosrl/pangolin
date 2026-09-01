import logger from "@server/logger";

/**
 * Create (if configured) and attach a path-rewrite middleware for a
 * resource, mutating both config_output.http.middlewares and the
 * router's middleware chain. Shared by the OSS and private Traefik config
 * generators, which apply it identically.
 */
export function applyPathRewriteMiddleware(
    config_output: any,
    resourceId: number,
    key: string,
    path: string | null,
    pathMatchType: string | null,
    rewritePath: string | null,
    rewritePathType: string | null,
    routerMiddlewares: string[]
) {
    if (
        rewritePath === null ||
        path === null ||
        !pathMatchType ||
        !rewritePathType
    ) {
        return;
    }

    const rewriteMiddlewareName = `rewrite-r${resourceId}-${key}`;

    try {
        const rewriteResult = createPathRewriteMiddleware(
            rewriteMiddlewareName,
            path,
            pathMatchType,
            rewritePath,
            rewritePathType
        );

        if (!config_output.http.middlewares) {
            config_output.http.middlewares = {};
        }

        Object.assign(
            config_output.http.middlewares,
            rewriteResult.middlewares
        );

        if (rewriteResult.chain) {
            // For chained middlewares (like stripPrefix + addPrefix)
            routerMiddlewares.push(...rewriteResult.chain);
        } else {
            // Single middleware
            routerMiddlewares.push(rewriteMiddlewareName);
        }
    } catch (error) {
        logger.error(
            `Failed to create path rewrite middleware for resource ${resourceId}: ${error}`
        );
    }
}

export default function createPathRewriteMiddleware(
    middlewareName: string,
    path: string,
    pathMatchType: string,
    rewritePath: string,
    rewritePathType: string
): { middlewares: { [key: string]: any }; chain?: string[] } {
    const middlewares: { [key: string]: any } = {};

    if (pathMatchType !== "regex" && !path.startsWith("/")) {
        path = `/${path}`;
    }

    if (
        rewritePathType !== "regex" &&
        rewritePath !== "" &&
        !rewritePath.startsWith("/")
    ) {
        rewritePath = `/${rewritePath}`;
    }

    switch (rewritePathType) {
        case "exact":
            // Replace the path with the exact rewrite path
            const exactPattern = `^${escapeRegex(path)}$`;
            middlewares[middlewareName] = {
                replacePathRegex: {
                    regex: exactPattern,
                    replacement: rewritePath
                }
            };
            break;

        case "prefix":
            // Replace matched prefix with new prefix, preserve the rest
            switch (pathMatchType) {
                case "prefix":
                    middlewares[middlewareName] = {
                        replacePathRegex: {
                            regex: `^${escapeRegex(path)}(.*)`,
                            replacement: `${rewritePath}$1`
                        }
                    };
                    break;
                case "exact":
                    middlewares[middlewareName] = {
                        replacePathRegex: {
                            regex: `^${escapeRegex(path)}$`,
                            replacement: rewritePath
                        }
                    };
                    break;
                case "regex":
                    // For regex path matching with prefix rewrite, we assume the regex has capture groups
                    middlewares[middlewareName] = {
                        replacePathRegex: {
                            regex: path,
                            replacement: rewritePath
                        }
                    };
                    break;
            }
            break;

        case "regex":
            // Use advanced regex replacement - works with any match type
            let regexPattern: string;
            if (pathMatchType === "regex") {
                regexPattern = path;
            } else if (pathMatchType === "prefix") {
                regexPattern = `^${escapeRegex(path)}(.*)`;
            } else {
                // exact
                regexPattern = `^${escapeRegex(path)}$`;
            }

            middlewares[middlewareName] = {
                replacePathRegex: {
                    regex: regexPattern,
                    replacement: rewritePath
                }
            };
            break;

        case "stripPrefix":
            // Strip the matched prefix and optionally add new path
            if (pathMatchType === "prefix") {
                middlewares[middlewareName] = {
                    stripPrefix: {
                        prefixes: [path]
                    }
                };

                // If rewritePath is provided and not empty, add it as a prefix after stripping
                if (rewritePath && rewritePath !== "" && rewritePath !== "/") {
                    const addPrefixMiddlewareName = `addprefix-${middlewareName.replace("rewrite-", "")}`;
                    middlewares[addPrefixMiddlewareName] = {
                        addPrefix: {
                            prefix: rewritePath
                        }
                    };
                    return {
                        middlewares,
                        chain: [middlewareName, addPrefixMiddlewareName]
                    };
                }
            } else {
                // For exact and regex matches, use replacePathRegex to strip
                let regexPattern: string;
                if (pathMatchType === "exact") {
                    regexPattern = `^${escapeRegex(path)}$`;
                } else if (pathMatchType === "regex") {
                    regexPattern = path;
                } else {
                    regexPattern = `^${escapeRegex(path)}`;
                }

                const replacement = rewritePath || "/";
                middlewares[middlewareName] = {
                    replacePathRegex: {
                        regex: regexPattern,
                        replacement: replacement
                    }
                };
            }
            break;

        default:
            logger.error(`Unknown rewritePathType: ${rewritePathType}`);
            throw new Error(`Unknown rewritePathType: ${rewritePathType}`);
    }

    return { middlewares };
}

function escapeRegex(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
