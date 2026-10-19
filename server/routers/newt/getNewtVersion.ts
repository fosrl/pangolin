import { db, orgs, sites } from "@server/db";
import { newts } from "@server/db";
import { eq } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import semver from "semver";
import { verifyPassword } from "@server/auth/password";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import logger from "@server/logger";
import { regionalCache as cache } from "#dynamic/lib/cache";
import config from "@server/lib/config";

type ReleaseInfo = {
    version: string;
    // binary filename -> sha256 hex (sourced from asset `digest` field in GitHub API)
    assetDigests: Record<string, string>;
};

// Cache key holding the last known good release info. It never expires, so
// it keeps serving if GitHub is unreachable, even across restarts/nodes.
const RELEASE_INFO_KEY = "cache:releaseInfo";
// Short-lived marker controlling how often we re-check GitHub. While it's
// missing (expired, or a previous attempt failed) every request retries.
const RELEASE_INFO_FRESH_KEY = "cache:releaseInfoFresh";
const RELEASE_INFO_REFRESH_SECONDS = 3600;

/**
 * Fetches the latest stable newt release from GitHub and returns the version
 * tag together with a map of asset-name → sha256 hex digest.
 * The last successful result is cached indefinitely and re-checked hourly;
 * on failure the last known good data keeps being served and every
 * subsequent request retries GitHub until it succeeds again.
 */
async function getLatestReleaseInfo(repo: string): Promise<ReleaseInfo | null> {
    const stored = await cache.get<ReleaseInfo>(`${RELEASE_INFO_KEY}:${repo}`);
    const isFresh = await cache.has(`${RELEASE_INFO_FRESH_KEY}:${repo}`);
    if (stored && isFresh) {
        return stored;
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const fetchResponse = await fetch(
            `https://api.github.com/repos/fosrl/${repo}/releases`,
            { signal: controller.signal }
        );

        clearTimeout(timeoutId);

        if (!fetchResponse.ok) {
            logger.warn(
                `Failed to fetch Newt releases from GitHub: ${fetchResponse.status} ${fetchResponse.statusText}`
            );
            return stored ?? null;
        }

        let releases: any[] = await fetchResponse.json();
        if (!Array.isArray(releases) || releases.length === 0) {
            logger.warn("No releases found for repository");
            return stored ?? null;
        }

        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        // Drop drafts, pre-releases, anything with "rc" in the tag name,
        // and releases published less than 1 day ago.
        releases = releases.filter(
            (r: any) =>
                !r.draft &&
                !r.prerelease &&
                !r.tag_name.includes("rc") &&
                !r.tag_name.includes("v") &&
                r.published_at &&
                new Date(r.published_at) <= oneDayAgo
        );

        // Sort descending by semver to find the true latest stable release.
        releases.sort((a: any, b: any) => {
            const va = semver.coerce(a.tag_name);
            const vb = semver.coerce(b.tag_name);
            if (!va && !vb) return 0;
            if (!va) return 1;
            if (!vb) return -1;
            return semver.rcompare(va, vb);
        });

        if (releases.length === 0) {
            logger.warn("No stable releases found for repository");
            return stored ?? null;
        }

        const latest = releases[0];
        const version: string = latest.tag_name;

        // Build a map of binary filename → sha256 hex from the asset `digest`
        // field returned by the GitHub API (format: "sha256:<hex>").
        const assetDigests: Record<string, string> = {};
        if (Array.isArray(latest.assets)) {
            for (const asset of latest.assets) {
                if (
                    typeof asset.name === "string" &&
                    typeof asset.digest === "string" &&
                    asset.digest.startsWith("sha256:")
                ) {
                    assetDigests[asset.name] = asset.digest.slice(
                        "sha256:".length
                    );
                }
            }
        }

        const info: ReleaseInfo = { version, assetDigests };
        await cache.set(RELEASE_INFO_KEY, info, 0);
        await cache.set(
            RELEASE_INFO_FRESH_KEY,
            true,
            RELEASE_INFO_REFRESH_SECONDS
        );
        return info;
    } catch (error: any) {
        if (error.name === "AbortError") {
            logger.warn("Request to fetch Newt releases timed out (5s)");
        } else {
            logger.warn(
                "Error fetching Newt releases:",
                error.message || error
            );
        }
        return stored ?? null;
    }
}

const bodySchema = z.object({
    newtId: z.string(),
    secret: z.string(),
    platform: z.string(), // e.g. "linux_amd64", "darwin_arm64"
    agent: z.string().optional().default("newt")
});

export type GetNewtVersionBody = z.infer<typeof bodySchema>;

export type GetNewtVersionResponse = {
    latestVersion: string;
    currentIsLatest: boolean;
    downloadUrl: string;
    sha256: string;
};

export async function getNewtVersion(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const parsedBody = bodySchema.safeParse(req.body);

    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    const { newtId, secret, platform, agent } = parsedBody.data;

    try {
        // Verify newt credentials
        const [existingNewt] = await db
            .select()
            .from(newts)
            .where(eq(newts.newtId, newtId))
            .limit(1);

        if (!existingNewt) {
            if (config.getRawConfig().app.log_failed_attempts) {
                logger.info(
                    `Newt version check: no newt found with ID ${newtId}. IP: ${req.ip}.`
                );
            }
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "Invalid credentials")
            );
        }

        if (!existingNewt.siteId) {
            logger.warn(`Newt ${newtId} has no associated site`);
            return next(
                createHttpError(
                    HttpCode.UNAUTHORIZED,
                    "Not associated with a site"
                )
            );
        }

        const validSecret = await verifyPassword(
            secret,
            existingNewt.secretHash
        );
        if (!validSecret) {
            if (config.getRawConfig().app.log_failed_attempts) {
                logger.info(
                    `Newt version check: invalid secret for newt ID ${newtId}. IP: ${req.ip}.`
                );
            }
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "Invalid credentials")
            );
        }

        // check if udpates are enabled for the org or the site
        const [site] = await db
            .select()
            .from(sites)
            .where(eq(sites.siteId, existingNewt.siteId))
            .limit(1);

        if (!site) {
            logger.warn(`Site with ID ${existingNewt.siteId} not found`);
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Associated site not found"
                )
            );
        }

        const [org] = await db
            .select()
            .from(orgs)
            .where(eq(orgs.orgId, site.orgId))
            .limit(1);

        if (!org) {
            logger.warn(`Org with ID ${site.orgId} not found`);
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Associated organization not found"
                )
            );
        }

        let doUpdate = false;

        if (site.autoUpdateOverrideOrg) {
            doUpdate = site.autoUpdateEnabled;
        } else {
            doUpdate = org.settingsEnableGlobalNewtAutoUpdate;
        }

        if (!doUpdate) {
            // return no content http code
            return response(res, {
                data: {
                    latestVersion: existingNewt.version ?? "",
                    currentIsLatest: true,
                    downloadUrl: "",
                    sha256: ""
                },
                success: true,
                error: false,
                message:
                    "Auto-updates are disabled for this site and organization",
                status: HttpCode.NO_CONTENT
            });
        }

        // Fetch latest release info (version + asset digests) in one API call.
        const releaseInfoNewt = await getLatestReleaseInfo("newt");
        let releaseInfoCli: ReleaseInfo | undefined | null;
        if (agent == "cli") {
            releaseInfoCli = await getLatestReleaseInfo("cli");
        }

        if (!releaseInfoNewt || (agent == "cli" && !releaseInfoCli)) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Unable to determine latest Newt version"
                )
            );
        }

        const latestVersion = releaseInfoNewt.version;

        // Binary name follows the get-newt.sh convention: newt_<platform>[.exe]
        const binaryNameNewt = platform.includes("windows")
            ? `newt_${platform}.exe`
            : `newt_${platform}`;

        const binaryNameCli = platform.includes("windows")
            ? `pangolin-cli_${platform}.exe`
            : `pangolin-cli_${platform}`;

        const downloadUrl = `https://github.com/fosrl/${agent}/releases/download/${agent == "cli" ? releaseInfoCli?.version : releaseInfoNewt.version}/${agent == "cli" ? binaryNameCli : binaryNameNewt}`;

        // Look up the SHA256 digest for this specific binary from the GitHub
        // release asset metadata (the `digest` field, format "sha256:<hex>").
        const sha256 =
            releaseInfoNewt.assetDigests[
                agent == "cli" ? binaryNameCli : binaryNameNewt
            ] ?? "";

        // Determine whether the newt that's asking is already up to date.
        // We store the current version on the newt row when it registers.
        const currentVersion = existingNewt.version ?? null;
        let currentIsLatest = false;
        if (currentVersion) {
            try {
                const latest = semver.coerce(latestVersion);
                const current = semver.coerce(currentVersion);
                if (latest && current) {
                    currentIsLatest = !semver.lt(current, latest);
                }
            } catch {
                // If we can't compare, assume not latest
            }
        }

        return response<GetNewtVersionResponse>(res, {
            data: {
                latestVersion, // this will always be the newt version
                currentIsLatest, // this will always be based on the newt version
                downloadUrl,
                sha256
            },
            success: true,
            error: false,
            message: "Version info retrieved successfully",
            status: HttpCode.OK
        });
    } catch (e) {
        logger.error(e);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to retrieve version info"
            )
        );
    }
}
