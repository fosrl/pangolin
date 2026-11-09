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

        // Versions and asset digests come from the Fossorial API, which
        // tracks GitHub releases and holds each one back for a day before
        // offering it to self-updating agents.
        const versions = await getLatestVersions();
        const releaseInfoNewt = versions?.newt?.autoUpdate;
        const releaseInfoAgent =
            agent == "cli" ? versions?.cli?.autoUpdate : releaseInfoNewt;

        if (!releaseInfoNewt || !releaseInfoAgent) {
            logger.warn(
                `Unable to determine the latest ${agent} version for auto-update`
            );
            return next(
                createHttpError(
                    HttpCode.SERVICE_UNAVAILABLE,
                    "Unable to determine latest Newt version"
                )
            );
        }

        const latestVersion = releaseInfoNewt.version;

        // Binary names follow the release asset convention:
        // newt_<platform>[.exe] and pangolin-cli_<platform>[.exe]
        const binaryPrefix = agent == "cli" ? "pangolin-cli" : "newt";
        const binaryName = platform.includes("windows")
            ? `${binaryPrefix}_${platform}.exe`
            : `${binaryPrefix}_${platform}`;

        const downloadUrl = `https://github.com/fosrl/${agent == "cli" ? "cli" : "newt"}/releases/download/${encodeURIComponent(releaseInfoAgent.version)}/${encodeURIComponent(binaryName)}`;

        // SHA256 of this binary, from the release asset metadata of the
        // repo the binary is actually downloaded from.
        const sha256 = releaseInfoAgent.assetDigests[binaryName] ?? "";
        if (!sha256) {
            logger.warn(
                `No sha256 digest found for ${binaryName} in ${agent} release ${releaseInfoAgent.version}`
            );
        }

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
