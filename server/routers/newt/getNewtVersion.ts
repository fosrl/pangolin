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
import config from "@server/lib/config";
import { getLatestVersions } from "@server/lib/latestVersions";

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

        const isCli = agent === "cli";
        const agentName = isCli ? "cli" : "newt";
        // The newt row stores the embedded newt version in `version` and the
        // agent's own version in `agentVersion` (equal to `version` for a
        // standalone newt).
        const currentVersion = isCli
            ? (existingNewt.agentVersion ?? null)
            : (existingNewt.version ?? null);

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
                    latestVersion: currentVersion ?? "",
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

        // Versions and asset digests come from the Fossorial API, which
        // tracks GitHub releases and holds each one back for a day before
        // offering it to self-updating agents.
        //
        // Each agent is compared against its own release line: a standalone
        // newt against newt releases, and the Pangolin CLI (which embeds newt
        // for `pangolin up site`) against CLI releases. Comparing the CLI's
        // embedded newt version against newt releases would make CLI sites
        // re-download the same CLI release in a loop whenever newt ships
        // ahead of the CLI, and miss CLI-only releases entirely.
        const versions = await getLatestVersions();
        const releaseInfo = isCli
            ? versions?.cli?.autoUpdate
            : versions?.newt?.autoUpdate;

        if (!releaseInfo) {
            logger.warn(
                `Unable to determine the latest ${agentName} version for auto-update`
            );
            return next(
                createHttpError(
                    HttpCode.SERVICE_UNAVAILABLE,
                    `Unable to determine latest ${agentName} version`
                )
            );
        }

        const latestVersion = releaseInfo.version;

        // Binary names follow the release asset convention:
        // newt_<platform>[.exe] and pangolin-cli_<platform>[.exe]
        const binaryPrefix = isCli ? "pangolin-cli" : "newt";
        const binaryName = platform.includes("windows")
            ? `${binaryPrefix}_${platform}.exe`
            : `${binaryPrefix}_${platform}`;

        const downloadUrl = `https://github.com/fosrl/${isCli ? "cli" : "newt"}/releases/download/${encodeURIComponent(latestVersion)}/${encodeURIComponent(binaryName)}`;

        // SHA256 of this binary, from the release asset metadata of the
        // repo the binary is actually downloaded from.
        const sha256 = releaseInfo.assetDigests[binaryName] ?? "";
        if (!sha256) {
            logger.warn(
                `No sha256 digest found for ${binaryName} in ${agentName} release ${latestVersion}`
            );
        }

        // Determine whether the agent that's asking is already up to date,
        // using the version it reported when it registered.
        let currentIsLatest = false;
        const latest = semver.coerce(latestVersion);
        const current = currentVersion ? semver.coerce(currentVersion) : null;
        if (latest && current) {
            currentIsLatest = !semver.lt(current, latest);
        } else if (isCli) {
            // Unknown or non-semver CLI version (e.g. a "dev" build, or a row
            // that hasn't registered with an agentVersion yet). Don't replace
            // it, since that could restart the site in a loop.
            currentIsLatest = true;
        }

        return response<GetNewtVersionResponse>(res, {
            data: {
                latestVersion,
                currentIsLatest,
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
