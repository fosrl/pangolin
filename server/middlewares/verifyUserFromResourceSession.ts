import { Response, NextFunction } from "express";
import { db } from "@server/db";
import { resourceSessions, users } from "@server/db";
import { eq } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { getUserOrgRoleIds } from "@server/lib/userOrgRoles";
import { getUserSessionWithUser } from "@server/db/queries/verifySessionQueries";
import { encodeHexLowerCase } from "@oslojs/encoding";
import { sha256 } from "@oslojs/crypto/sha2";
import config from "@server/lib/config";
import logger from "@server/logger";

export const verifyUserFromResourceSessionMiddleware = async (
    req: any,
    res: Response,
    next: NextFunction
) => {
    if (!req.user) {
        const sessionCookieName =
            config.getRawConfig().server.session_cookie_name;

        // Collect all resource session cookies (format: {name}[_s].{timestamp}=token)
        const cookieHeader: string | undefined = req.headers.cookie;
        const candidates: { timestamp: number; token: string }[] = [];

        if (cookieHeader) {
            for (const part of cookieHeader.split(";")) {
                const trimmed = part.trim();
                const eqIdx = trimmed.indexOf("=");
                if (eqIdx === -1) continue;

                const cookieName = trimmed.slice(0, eqIdx).trim();
                const cookieValue = trimmed.slice(eqIdx + 1).trim();

                // Match both secure (_s.timestamp) and non-secure (.timestamp) variants
                const securePrefix = `${sessionCookieName}_s.`;
                const httpPrefix = `${sessionCookieName}.`;

                let timestampStr: string | null = null;
                if (cookieName.startsWith(securePrefix)) {
                    timestampStr = cookieName.slice(securePrefix.length);
                } else if (cookieName.startsWith(httpPrefix)) {
                    timestampStr = cookieName.slice(httpPrefix.length);
                }

                if (timestampStr !== null && /^\d+$/.test(timestampStr)) {
                    candidates.push({
                        timestamp: parseInt(timestampStr, 10),
                        token: cookieValue
                    });
                }
            }
        }

        // Pick the most recently issued session (highest timestamp)
        candidates.sort((a, b) => b.timestamp - a.timestamp);
        const best = candidates[0];

        if (best) {
            try {
                const sessionId = encodeHexLowerCase(
                    sha256(new TextEncoder().encode(best.token))
                );

                const [resourceSession] = await db
                    .select()
                    .from(resourceSessions)
                    .where(eq(resourceSessions.sessionId, sessionId))
                    .limit(1);

                if (resourceSession && Date.now() < resourceSession.expiresAt) {
                    if (resourceSession.userSessionId) {
                        const result = await getUserSessionWithUser(
                            resourceSession.userSessionId
                        );

                        if (result?.user && result?.session) {
                            req.user = result.user;
                            req.session = result.session;
                        }
                    }
                }
            } catch (e) {
                logger.error(
                    "verifyUserFromResourceSessionMiddleware: failed to validate resource session",
                    e
                );
            }
        }
    }

    // Populate userOrgRoleIds if an orgId is available in route params
    if (req.user && req.params?.orgId && !req.userOrgRoleIds) {
        req.userOrgRoleIds = await getUserOrgRoleIds(
            req.user.userId,
            req.params.orgId
        );
    }

    next();
};
