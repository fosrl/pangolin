type CleanRedirectOptions = {
    fallback?: string;
    maxRedirectDepth?: number;
    /** When true, preserve all query params on the path (for internal redirects). Default false. */
    allowAllQueryParams?: boolean;
};

const ALLOWED_QUERY_PARAMS = new Set([
    "forceLogin",
    "code",
    "token",
    "redirect"
]);

const DUMMY_BASE = "https://internal.local";

export function cleanOAuthRedirectOptions(path: string | undefined | null): CleanRedirectOptions {
    return path?.startsWith("/oauth/authorize") ? { allowAllQueryParams: true } : {};
}

export function cleanRedirect(
    input: string,
    options: CleanRedirectOptions = {}
): string {
    const {
        fallback = "/",
        maxRedirectDepth = 2,
        allowAllQueryParams = false
    } = options;

    if (!input || typeof input !== "string") {
        return fallback;
    }

    try {
        return sanitizeUrl(input, fallback, maxRedirectDepth, allowAllQueryParams);
    } catch {
        return fallback;
    }
}

function sanitizeUrl(
    input: string,
    fallback: string,
    remainingRedirectDepth: number,
    allowAllQueryParams: boolean = false
): string {
    if (
        input.startsWith("javascript:") ||
        input.startsWith("data:") ||
        input.startsWith("//")
    ) {
        return fallback;
    }

    const url = new URL(input, DUMMY_BASE);

    // Must be a relative/internal path
    if (url.origin !== DUMMY_BASE) {
        return fallback;
    }

    if (!url.pathname.startsWith("/")) {
        return fallback;
    }

    const cleanParams = new URLSearchParams();

    for (const [key, value] of url.searchParams.entries()) {
        if (!allowAllQueryParams && !ALLOWED_QUERY_PARAMS.has(key)) {
            continue;
        }

        if (key === "redirect") {
            if (remainingRedirectDepth <= 0) {
                continue;
            }

            const cleanedRedirect = sanitizeUrl(
                value,
                "",
                remainingRedirectDepth - 1,
                allowAllQueryParams
            );

            if (cleanedRedirect) {
                cleanParams.set("redirect", cleanedRedirect);
            }

            continue;
        }

        cleanParams.set(key, value);
    }

    const queryString = cleanParams.toString();
    return queryString ? `${url.pathname}?${queryString}` : url.pathname;
}
