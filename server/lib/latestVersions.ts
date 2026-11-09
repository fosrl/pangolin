import logger from "@server/logger";
import { regionalCache as cache } from "#dynamic/lib/cache";

const VERSIONS_URL = "https://api.fossorial.io/api/v1/versions";
const FETCH_TIMEOUT_MS = 5000;

// Last known good response. Never expires, so it keeps serving while the
// Fossorial API is unreachable, even across restarts/nodes (with redis).
const VERSIONS_KEY = "cache:fossorialVersions";
// Short-lived marker controlling how often we re-check. The Fossorial API
// itself refreshes from GitHub every 30 minutes, so polling faster is wasted.
const VERSIONS_FRESH_KEY = "cache:fossorialVersionsFresh";
const VERSIONS_REFRESH_SECONDS = 15 * 60;

export type AutoUpdateInfo = {
    // Release tag that self-updating agents should move to. The Fossorial
    // API holds a release back for a day after it's published.
    version: string;
    // release asset filename -> sha256 hex
    assetDigests: Record<string, string>;
};

export type ProductVersion = {
    latestVersion: string;
    releaseNotes: string;
    autoUpdate?: AutoUpdateInfo;
};

// Keys match the Fossorial API response (including its "panglin-node" typo).
export type ProductName =
    | "pangolin"
    | "newt"
    | "cli"
    | "olm"
    | "windows"
    | "linux"
    | "android"
    | "panglin-node"
    | "ios"
    | "mac";

export type LatestVersions = Partial<Record<ProductName, ProductVersion>>;

let inflight: Promise<LatestVersions | null> | null = null;

async function fetchLatestVersions(
    stored: LatestVersions | undefined
): Promise<LatestVersions | null> {
    try {
        const res = await fetch(VERSIONS_URL, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
        });

        if (!res.ok) {
            logger.warn(
                `Failed to fetch latest versions from the Fossorial API: ${res.status} ${res.statusText}`
            );
            return stored ?? null;
        }

        const body = await res.json();
        const data = body?.data;
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            logger.warn("Fossorial API returned no version data");
            return stored ?? null;
        }

        // Keep products the API couldn't resolve this time from the last
        // good response, so a partial refresh never loses data.
        const versions: LatestVersions = { ...stored, ...data };

        await cache.set(VERSIONS_KEY, versions, 0);
        await cache.set(VERSIONS_FRESH_KEY, true, VERSIONS_REFRESH_SECONDS);
        return versions;
    } catch (error: any) {
        if (error?.name === "TimeoutError" || error?.name === "AbortError") {
            logger.warn(
                `Request for latest versions to the Fossorial API timed out (${FETCH_TIMEOUT_MS}ms)`
            );
        } else {
            logger.warn(
                "Error fetching latest versions from the Fossorial API:",
                error?.message || error
            );
        }
        return stored ?? null;
    }
}

/**
 * Returns the latest released versions of every Fossorial product, as
 * reported by the Fossorial API (which tracks GitHub releases so Pangolin
 * doesn't have to). The last good response is cached indefinitely and
 * re-checked every 15 minutes; when the API is unreachable the cached data
 * keeps being served and each later call retries.
 */
export async function getLatestVersions(): Promise<LatestVersions | null> {
    const stored = await cache.get<LatestVersions>(VERSIONS_KEY);
    if (stored && (await cache.has(VERSIONS_FRESH_KEY))) {
        return stored;
    }

    // Collapse concurrent refreshes in this process into one request.
    if (!inflight) {
        inflight = fetchLatestVersions(stored).finally(() => {
            inflight = null;
        });
    }
    return inflight;
}

export async function getLatestVersion(
    product: ProductName
): Promise<ProductVersion | null> {
    const versions = await getLatestVersions();
    return versions?.[product] ?? null;
}
