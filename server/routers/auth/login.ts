import {
    createSession,
    generateSessionToken,
    serializeSessionCookie
} from "@server/auth/sessions/app";
import { db, resources } from "@server/db";
import { users, securityKeys } from "@server/db";
import HttpCode from "@server/types/HttpCode";
import response from "@server/lib/response";
import { eq, and } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { verifyTotpCode } from "@server/auth/totp";
import config from "@server/lib/config";
import logger from "@server/logger";
import { verifyPassword } from "@server/auth/password";
import { verifySession } from "@server/auth/sessions/verifySession";
import { UserType } from "@server/types/UserTypes";
import { logAccessAudit } from "#dynamic/lib/logAccessAudit";

export const loginBodySchema = z
    .object({
        email: z.string().toLowerCase().email(),
        password: z.string(),
        code: z.string().optional(),
        resourceGuid: z.string().optional()
    })
    .strict();

export type LoginBody = z.infer<typeof loginBodySchema>;

export type LoginResponse = {
    codeRequested?: boolean;
    emailVerificationRequired?: boolean;
    useSecurityKey?: boolean;
    twoFactorSetupRequired?: boolean;
};

export async function login(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const parsedBody = loginBodySchema.safeParse(req.body);

    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    const { email, password, code, resourceGuid } = parsedBody.data;

    try {
        const { session: existingSession } = await verifySession(req);
        if (existingSession) {
            return response<null>(res, {
                data: null,
                success: true,
                error: false,
                message: "Already logged in",
                status: HttpCode.OK
            });
        }

        let resourceId: number | null = null;
        let orgId: string | null = null;
        if (resourceGuid) {
            const [resource] = await db
                .select()
                .from(resources)
                .where(eq(resources.resourceGuid, resourceGuid))
                .limit(1);

            if (!resource) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `Resource with GUID ${resourceGuid} not found`
                    )
                );
            }

            resourceId = resource.resourceId;
            orgId = resource.orgId;
        }

        const existingUserRes = await db
            .select()
            .from(users)
            .where(
                and(eq(users.type, UserType.Internal), eq(users.email, email))
            );
        if (!existingUserRes || !existingUserRes.length) {
            if (config.getRawConfig().app.log_failed_attempts) {
                logger.info(
                    `Username or password incorrect. Email: ${email}. IP: ${req.ip}.`
                );
            }

            if (resourceId && orgId) {
                logAccessAudit({
                    orgId: orgId,
                    resourceId: resourceId,
                    action: false,
                    type: "login",
                    userAgent: req.headers["user-agent"],
                    requestIp: req.ip
                });
            }

            return next(
                createHttpError(
                    HttpCode.UNAUTHORIZED,
                    "Username or password is incorrect"
                )
            );
        }

        const existingUser = existingUserRes[0];

        const validPassword = await verifyPassword(
            password,
            existingUser.passwordHash!
        );
        if (!validPassword) {
            if (config.getRawConfig().app.log_failed_attempts) {
                logger.info(
                    `Username or password incorrect. Email: ${email}. IP: ${req.ip}.`
                );
            }

            if (resourceId && orgId) {
                logAccessAudit({
                    orgId: orgId,
                    resourceId: resourceId,
                    action: false,
                    type: "login",
                    userAgent: req.headers["user-agent"],
                    requestIp: req.ip
                });
            }

            return next(
                createHttpError(
                    HttpCode.UNAUTHORIZED,
                    "Username or password is incorrect"
                )
            );
        }

        // // Check if user has security keys registered
        // const userSecurityKeys = await db
        //     .select()
        //     .from(securityKeys)
        //     .where(eq(securityKeys.userId, existingUser.userId));
        //
        // if (userSecurityKeys.length > 0) {
        //     return response<LoginResponse>(res, {
        //         data: { useSecurityKey: true },
        //         success: true,
        //         error: false,
        //         message: "Security key authentication required",
        //         status: HttpCode.OK
        //     });
        // }

        if (
            existingUser.twoFactorSetupRequested &&
            !existingUser.twoFactorEnabled
        ) {
            return response<LoginResponse>(res, {
                data: { twoFactorSetupRequired: true },
                success: true,
                error: false,
                message: "Two-factor authentication setup required",
                status: HttpCode.ACCEPTED
            });
        }

        if (existingUser.twoFactorEnabled) {
            if (!code) {
                return response<{ codeRequested: boolean }>(res, {
                    data: { codeRequested: true },
                    success: true,
                    error: false,
                    message: "Two-factor authentication required",
                    status: HttpCode.ACCEPTED
                });
            }

            const validOTP = await verifyTotpCode(
                code,
                existingUser.twoFactorSecret!,
                existingUser.userId
            );

            if (!validOTP) {
                if (config.getRawConfig().app.log_failed_attempts) {
                    logger.info(
                        `Two-factor code incorrect. Email: ${email}. IP: ${req.ip}.`
                    );
                }

                if (resourceId && orgId) {
                    logAccessAudit({
                        orgId: orgId,
                        resourceId: resourceId,
                        action: false,
                        type: "login",
                        userAgent: req.headers["user-agent"],
                        requestIp: req.ip
                    });
                }

                return next(
                    createHttpError(
                        HttpCode.UNAUTHORIZED,
                        "The two-factor code you entered is incorrect"
                    )
                );
            }
        }

        const token = generateSessionToken();
        const sess = await createSession(token, existingUser.userId);
        const isSecure = req.protocol === "https";
        const cookie = serializeSessionCookie(
            token,
            isSecure,
            new Date(sess.expiresAt)
        );

        res.appendHeader("Set-Cookie", cookie);

        if (
            !existingUser.emailVerified &&
            config.getRawConfig().flags?.require_email_verification
        ) {
            return response<LoginResponse>(res, {
                data: { emailVerificationRequired: true },
                success: true,
                error: false,
                message: "Email verification code sent",
                status: HttpCode.OK
            });
        }

        return response<null>(res, {
            data: null,
            success: true,
            error: false,
            message: "Logged in successfully",
            status: HttpCode.OK
        });
    } catch (e) {
        logger.error(e);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to authenticate user"
            )
        );
    }
}
