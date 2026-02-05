import { generateSessionToken } from "@server/auth/sessions/app";
import { db, newtSessions } from "@server/db";
import { getOrCreateCachedToken } from "#dynamic/lib/tokenCache";
import { EXPIRES } from "@server/auth/sessions/newt";
import { newts, sites } from "@server/db";
import HttpCode from "@server/types/HttpCode";
import response from "@server/lib/response";
import { eq } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import {
    createNewtSession,
    validateNewtSessionToken
} from "@server/auth/sessions/newt";
import { verifyPassword } from "@server/auth/password";
import logger from "@server/logger";
import config from "@server/lib/config";
import { APP_VERSION } from "@server/lib/consts";
import { isIP } from "node:net";

export const newtGetTokenBodySchema = z.object({
    newtId: z.string(),
    secret: z.string(),
    token: z.string().optional()
});

export type NewtGetTokenBody = z.infer<typeof newtGetTokenBodySchema>;

function normalizeIp(ip?: string | null): string | null {
    if (!ip) return null;
    let normalized = ip.trim();
    if (normalized.startsWith("::ffff:")) {
        normalized = normalized.slice(7);
    }
    return normalized;
}

function isPrivateOrReservedIPv4(ip: string): boolean {
    const octets = ip.split(".").map(Number);
    if (octets.length !== 4 || octets.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
        return true;
    }

    const [a, b] = octets;

    return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 0) ||
        (a === 192 && b === 168) ||
        (a === 198 && (b === 18 || b === 19))
    );
}

function getPublicIPv4Candidate(req: Request): string | null {
    const socketIp = normalizeIp(req.socket?.remoteAddress);
    if (socketIp && isIP(socketIp) === 4 && !isPrivateOrReservedIPv4(socketIp)) {
        return socketIp;
    }

    const reqIp = normalizeIp(req.ip);
    if (reqIp && isIP(reqIp) === 4 && !isPrivateOrReservedIPv4(reqIp)) {
        return reqIp;
    }

    return null;
}

export async function getNewtToken(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const parsedBody = newtGetTokenBodySchema.safeParse(req.body);

    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    const { newtId, secret, token } = parsedBody.data;

    try {
        if (token) {
            const { session, newt } = await validateNewtSessionToken(token);
            if (session) {
                if (config.getRawConfig().app.log_failed_attempts) {
                    logger.info(
                        `Newt session already valid. Newt ID: ${newtId}. IP: ${req.ip}.`
                    );
                }
                return response<null>(res, {
                    data: null,
                    success: true,
                    error: false,
                    message: "Token session already valid",
                    status: HttpCode.OK
                });
            }
        }

        const existingNewtRes = await db
            .select()
            .from(newts)
            .where(eq(newts.newtId, newtId));
        if (!existingNewtRes || !existingNewtRes.length) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "No newt found with that newtId"
                )
            );
        }

        const existingNewt = existingNewtRes[0];

        const validSecret = await verifyPassword(
            secret,
            existingNewt.secretHash
        );
        if (!validSecret) {
            if (config.getRawConfig().app.log_failed_attempts) {
                logger.info(
                    `Newt id or secret is incorrect. Newt: ID ${newtId}. IP: ${req.ip}.`
                );
            }
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Secret is incorrect")
            );
        }

        // Return a cached token if one exists to prevent thundering herd on
        // simultaneous restarts; falls back to creating a fresh session when
        // Redis is unavailable or the cache has expired.
        const resToken = await getOrCreateCachedToken(
            `newt:token_cache:${existingNewt.newtId}`,
            config.getRawConfig().server.secret!,
            Math.floor(EXPIRES / 1000),
            async () => {
                const token = generateSessionToken();
                await createNewtSession(token, existingNewt.newtId);
                return token;
            }
        );

        // Auto-detect and update site's publicIp if not already set
        if (existingNewt.siteId) {
            const clientIp = getPublicIPv4Candidate(req);

            if (clientIp) {
                // Only update if the site's publicIp is null/empty
                const [site] = await db
                    .select({ publicIp: sites.publicIp })
                    .from(sites)
                    .where(eq(sites.siteId, existingNewt.siteId))
                    .limit(1);

                if (site && !site.publicIp) {
                    await db
                        .update(sites)
                        .set({ publicIp: clientIp })
                        .where(eq(sites.siteId, existingNewt.siteId));
                    logger.debug(`Auto-detected site publicIp: ${clientIp} for site ${existingNewt.siteId}`);
                }
            } else {
                logger.debug(`Skipped site publicIp auto-detection for site ${existingNewt.siteId}: no public IPv4 candidate available`);
            }
        }

        return response<{ token: string; serverVersion: string }>(res, {
            data: {
                token: resToken,
                serverVersion: APP_VERSION
            },
            success: true,
            error: false,
            message: "Token created successfully",
            status: HttpCode.OK
        });
    } catch (e) {
        console.error(e);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to authenticate newt"
            )
        );
    }
}
