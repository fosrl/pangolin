import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { resources } from "@server/db";
import { eq } from "drizzle-orm";
import { createResourceSession } from "@server/auth/sessions/resource";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { fromError } from "zod-validation-error";
import logger from "@server/logger";
import { generateSessionToken } from "@server/auth/sessions/app";
import config from "@server/lib/config";
import { encodeHexLowerCase } from "@oslojs/encoding";
import { sha256 } from "@oslojs/crypto/sha2";
import { response } from "@server/lib/response";
import { checkOrgAccessPolicy } from "#dynamic/lib/checkOrgAccessPolicy";
import { logAccessAudit } from "#dynamic/lib/logAccessAudit";
import { isResourceReauthRequired } from "#dynamic/lib/resourceSessionReauth";

const getExchangeTokenParams = z.strictObject({
    resourceId: z.coerce.number().int().positive()
});

export type GetExchangeTokenResponse =
    | { requestToken: string; reauthRequired?: false }
    // An admin revoked this dashboard session's access to the resource, so
    // the user has to log in again instead of being signed in silently.
    | { requestToken?: undefined; reauthRequired: true };

export async function getExchangeToken(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = getExchangeTokenParams.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { resourceId } = parsedParams.data;

        const [resource] = await db
            .select()
            .from(resources)
            .where(eq(resources.resourceId, resourceId))
            .limit(1);

        if (!resource) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource with ID ${resourceId} not found`
                )
            );
        }

        const ssoSession =
            req.cookies[config.getRawConfig().server.session_cookie_name];
        if (!ssoSession) {
            logger.debug(ssoSession);
            return next(
                createHttpError(
                    HttpCode.UNAUTHORIZED,
                    "Missing SSO session cookie"
                )
            );
        }

        // check org policy here
        const hasAccess = await checkOrgAccessPolicy({
            orgId: resource.orgId,
            userId: req.user!.userId,
            session: req.session
        });

        if (!hasAccess.allowed || hasAccess.error) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "" + (hasAccess.error || "Unknown error")
                )
            );
        }

        const sessionId = encodeHexLowerCase(
            sha256(new TextEncoder().encode(ssoSession))
        );

        if (await isResourceReauthRequired(sessionId, resourceId)) {
            return response<GetExchangeTokenResponse>(res, {
                data: { reauthRequired: true },
                success: true,
                error: false,
                message: "Login required",
                status: HttpCode.OK
            });
        }

        const token = generateSessionToken();
        const requestSession = await createResourceSession({
            resourceId,
            token,
            userSessionId: sessionId,
            isRequestToken: true,
            expiresAt: Date.now() + 1000 * 30, // 30 seconds
            sessionLength: 1000 * 30,
            doNotExtend: true
        });

        if (req.user) {
            logAccessAudit({
                orgId: resource.orgId,
                resourceId: resourceId,
                user: {
                    username: req.user.username,
                    userId: req.user.userId
                },
                action: true,
                type: "login",
                // The request token is exchanged for the real session, which
                // keeps this id as its requestSessionId
                metadata: { resourceSessionId: requestSession.sessionId },
                userAgent: req.headers["user-agent"],
                requestIp: req.ip
            });
        }

        logger.debug("Request token created successfully");

        return response<GetExchangeTokenResponse>(res, {
            data: {
                requestToken: token
            },
            success: true,
            error: false,
            message: "Request token created successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
