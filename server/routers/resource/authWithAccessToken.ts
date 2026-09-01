import { generateSessionToken } from "@server/auth/sessions/app";
import { db, users } from "@server/db";
import HttpCode from "@server/types/HttpCode";
import response from "@server/lib/response";
import { eq } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { createResourceSession } from "@server/auth/sessions/resource";
import logger from "@server/logger";
import { verifyResourceAccessToken } from "@server/auth/verifyResourceAccessToken";
import config from "@server/lib/config";
import stoi from "@server/lib/stoi";
import { logAccessAudit } from "#dynamic/lib/logAccessAudit";
import { normalizePostAuthPath } from "@server/lib/normalizePostAuthPath";

const authWithAccessTokenBodySchema = z.strictObject({
    accessToken: z.string(),
    accessTokenId: z.string().optional()
});

const authWithAccessTokenParamsSchema = z.strictObject({
    resourceId: z
        .string()
        .optional()
        .transform(stoi)
        .pipe(z.int().positive().optional())
});

export type AuthWithAccessTokenResponse = {
    session?: string;
    redirectUrl?: string | null;
};

export async function authWithAccessToken(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const parsedBody = authWithAccessTokenBodySchema.safeParse(req.body);

    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    const parsedParams = authWithAccessTokenParamsSchema.safeParse(req.params);

    if (!parsedParams.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedParams.error).toString()
            )
        );
    }

    const { resourceId } = parsedParams.data;
    const { accessToken, accessTokenId } = parsedBody.data;

    try {
        const { valid, tokenItem, error, resource } =
            await verifyResourceAccessToken({
                accessToken,
                accessTokenId,
                resourceId
            });

        if (!valid || !tokenItem || !resource) {
            if (resource) {
                if (config.getRawConfig().app.log_failed_attempts) {
                    logger.info(
                        `Resource access token invalid. Resource ID: ${resource.resourceId}. IP: ${req.ip}.`
                    );
                }

                logAccessAudit({
                    orgId: resource.orgId,
                    resourceId: resource.resourceId,
                    action: false,
                    type: "accessToken",
                    userAgent: req.headers["user-agent"],
                    requestIp: req.ip
                });
            }

            return next(
                createHttpError(
                    HttpCode.UNAUTHORIZED,
                    error || "Access token does not exist for resource"
                )
            );
        }

        const token = generateSessionToken();
        await createResourceSession({
            resourceId: resource.resourceId,
            token,
            accessTokenId: tokenItem.accessTokenId,
            isRequestToken: true,
            expiresAt: Date.now() + 1000 * 30, // 30 seconds
            sessionLength: 1000 * 30,
            doNotExtend: true
        });

        let accessAuditUser: { username: string; userId: string } | undefined;
        if (tokenItem.userId) {
            const [associatedUser] = await db
                .select({
                    userId: users.userId,
                    username: users.username
                })
                .from(users)
                .where(eq(users.userId, tokenItem.userId))
                .limit(1);
            if (associatedUser) {
                accessAuditUser = {
                    userId: associatedUser.userId,
                    username: associatedUser.username
                };
            }
        }

        logAccessAudit({
            orgId: resource.orgId,
            resourceId: resource.resourceId,
            action: true,
            type: "accessToken",
            apiKey: accessAuditUser
                ? undefined
                : {
                      name: tokenItem.title,
                      apiKeyId: tokenItem.accessTokenId
                  },
            user: accessAuditUser,
            metadata: accessAuditUser
                ? {
                      accessTokenId: tokenItem.accessTokenId,
                      accessTokenTitle: tokenItem.title
                  }
                : undefined,
            userAgent: req.headers["user-agent"],
            requestIp: req.ip
        });

        let redirectUrl = `${resource.ssl ? "https" : "http"}://${resource.fullDomain}`;
        const postAuthPath = normalizePostAuthPath(resource.postAuthPath);
        if (tokenItem.path) {
            // add the path from the access token to the redirect URL, ensuring there is exactly one slash between the domain and the path
            redirectUrl =
                redirectUrl.replace(/\/?$/, "/") +
                tokenItem.path.replace(/^\/?/, "");
        } else if (postAuthPath) {
            redirectUrl = redirectUrl + postAuthPath;
        }

        return response<AuthWithAccessTokenResponse>(res, {
            data: {
                session: token,
                redirectUrl
            },
            success: true,
            error: false,
            message: "Authenticated with resource successfully",
            status: HttpCode.OK
        });
    } catch (e) {
        logger.error(e);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to authenticate with resource"
            )
        );
    }
}
