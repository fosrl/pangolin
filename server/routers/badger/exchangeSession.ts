import HttpCode from "@server/types/HttpCode";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import logger from "@server/logger";
import { resourceAccessToken, resources, sessions } from "@server/db";
import { db } from "@server/db";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
    createResourceSession,
    serializeResourceSessionCookie,
    validateResourceSessionToken
} from "@server/auth/sessions/resource";
import {
    generateSessionToken,
    SESSION_COOKIE_EXPIRES
} from "@server/auth/sessions/app";
import { SESSION_COOKIE_EXPIRES as RESOURCE_SESSION_COOKIE_EXPIRES } from "@server/auth/sessions/resource";
import config from "@server/lib/config";
import { response } from "@server/lib/response";
import { stripPortFromHost } from "@server/lib/ip";

const exchangeSessionBodySchema = z.object({
    requestToken: z.string(),
    host: z.string(),
    requestIp: z.string().optional()
});

export type ExchangeSessionBodySchema = z.infer<
    typeof exchangeSessionBodySchema
>;

export type ExchangeSessionResponse = {
    valid: boolean;
    cookie?: string;
};

export async function exchangeSession(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    logger.debug("Exchange session: Badger sent", req.body);

    const parsedBody = exchangeSessionBodySchema.safeParse(req.body);

    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    try {
        const { requestToken, host, requestIp } = parsedBody.data;
        let cleanHost = host;
        // if the host ends with :port
        if (cleanHost.match(/:[0-9]{1,5}$/)) {
            const matched = "" + cleanHost.match(/:[0-9]{1,5}$/);
            cleanHost = cleanHost.slice(0, -1 * matched.length);
        }

        const clientIp = requestIp ? stripPortFromHost(requestIp) : undefined;

        const parts = cleanHost.split(".");
        const wildcardCandidates: string[] = [];
        for (let i = 1; i < parts.length; i++) {
            wildcardCandidates.push(`*.${parts.slice(i).join(".")}`);
        }

        const potentialResources = await db
            .select()
            .from(resources)
            .where(
                or(
                    eq(resources.fullDomain, cleanHost),
                    wildcardCandidates.length > 0
                        ? and(
                              eq(resources.wildcard, true),
                              inArray(resources.fullDomain, wildcardCandidates)
                          )
                        : sql`false`
                )
            );

        const exactMatch = potentialResources.find(
            (r) => r.fullDomain === cleanHost
        );
        const resource = exactMatch ?? potentialResources[0];

        if (!resource) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource with host ${cleanHost} not found`
                )
            );
        }

        const { resourceSession: requestSession } =
            await validateResourceSessionToken(
                requestToken,
                resource.resourceId
            );

        if (!requestSession) {
            if (config.getRawConfig().app.log_failed_attempts) {
                logger.info(
                    `Exchange token is invalid. Resource ID: ${resource.resourceId}. IP: ${clientIp}.`
                );
            }
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "Invalid request token")
            );
        }

        if (!requestSession.isRequestToken) {
            if (config.getRawConfig().app.log_failed_attempts) {
                logger.info(
                    `Exchange token is invalid. Resource ID: ${resource.resourceId}. IP: ${clientIp}.`
                );
            }
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "Invalid request token")
            );
        }

        await db.delete(sessions).where(eq(sessions.sessionId, requestToken));

        const token = generateSessionToken();

        let expiresAt: number | null = null;

        if (requestSession.userSessionId) {
            const [res] = await db
                .select()
                .from(sessions)
                .where(eq(sessions.sessionId, requestSession.userSessionId))
                .limit(1);
            if (res) {
                await createResourceSession({
                    token,
                    resourceId: resource.resourceId,
                    isRequestToken: false,
                    userSessionId: requestSession.userSessionId,
                    doNotExtend: false,
                    expiresAt: res.expiresAt,
                    sessionLength: SESSION_COOKIE_EXPIRES
                });
                expiresAt = res.expiresAt;
            }
        } else if (requestSession.accessTokenId) {
            const [res] = await db
                .select()
                .from(resourceAccessToken)
                .where(
                    eq(
                        resourceAccessToken.accessTokenId,
                        requestSession.accessTokenId
                    )
                )
                .limit(1);
            if (res) {
                await createResourceSession({
                    token,
                    resourceId: resource.resourceId,
                    isRequestToken: false,
                    accessTokenId: requestSession.accessTokenId,
                    doNotExtend: true,
                    expiresAt: res.expiresAt,
                    sessionLength: res.sessionLength
                });
                expiresAt = res.expiresAt;
            }
        } else {
            const expires = new Date(
                Date.now() + SESSION_COOKIE_EXPIRES
            ).getTime();
            await createResourceSession({
                token,
                resourceId: resource.resourceId,
                isRequestToken: false,
                passwordId: requestSession.passwordId,
                pincodeId: requestSession.pincodeId,
                userSessionId: requestSession.userSessionId,
                whitelistId: requestSession.whitelistId,
                accessTokenId: requestSession.accessTokenId,
                policyPasswordId: requestSession.policyPasswordId,
                policyPincodeId: requestSession.policyPincodeId,
                policyWhitelistId: requestSession.policyWhitelistId,
                doNotExtend: false,
                expiresAt: expires,
                sessionLength: RESOURCE_SESSION_COOKIE_EXPIRES
            });
            expiresAt = expires;
        }

        const cookieName = `${config.getRawConfig().server.session_cookie_name}`;
        const cookie = serializeResourceSessionCookie(
            cookieName,
            cleanHost,
            token,
            !resource.ssl,
            expiresAt ? new Date(expiresAt) : undefined
        );

        logger.debug(JSON.stringify("Exchange cookie: " + cookie));
        return response<ExchangeSessionResponse>(res, {
            data: { valid: true, cookie },
            success: true,
            error: false,
            message: "Session exchanged successfully",
            status: HttpCode.OK
        });
    } catch (e) {
        console.error(e);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to exchange session"
            )
        );
    }
}
