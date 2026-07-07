import { Request, Response, NextFunction } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import HttpCode from "@server/types/HttpCode";
import { response } from "@server/lib/response";
import { db } from "@server/db";
import { twoFactorBackupCodes, User, users } from "@server/db";
import { eq, and } from "drizzle-orm";
import { hashPassword, verifyPassword } from "@server/auth/password";
import { verifyTotpCode } from "@server/auth/totp";
import logger from "@server/logger";
import { sendEmail } from "@server/emails";
import TwoFactorAuthNotification from "@server/emails/templates/TwoFactorAuthNotification";
import config from "@server/lib/config";
import { UserType } from "@server/types/UserTypes";
import { generateBackupCodes } from "@server/lib/totp";
import {
    invalidateAllSessions,
    invalidateAllSessionsExceptCurrent
} from "@server/auth/sessions/app";
import { verifySession } from "@server/auth/sessions/verifySession";
import { unauthorized } from "@server/auth/unauthorizedResponse";

export const verifyTotpBody = z.strictObject({
    email: z.email().optional(),
    password: z.string().optional(),
    code: z.string()
});

export type VerifyTotpBody = z.infer<typeof verifyTotpBody>;

export type VerifyTotpResponse = {
    valid: boolean;
    backupCodes?: string[];
};

export async function verifyTotp(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const parsedBody = verifyTotpBody.safeParse(req.body);

    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    const { code, email, password } = parsedBody.data;

    try {
        const { user: sessionUser, session: existingSession } =
            await verifySession(req);

        let user: User | null = sessionUser;
        if (!existingSession) {
            if (!email || !password) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Email and password are required for two-factor authentication"
                    )
                );
            }
            const [res] = await db
                .select()
                .from(users)
                .where(
                    and(
                        eq(users.type, UserType.Internal),
                        eq(users.email, email)
                    )
                );
            user = res;

            const validPassword = await verifyPassword(
                password,
                user.passwordHash!
            );
            if (!validPassword) {
                return next(unauthorized());
            }
        }

        if (!user) {
            if (config.getRawConfig().app.log_failed_attempts) {
                logger.info(
                    `Username or password incorrect. Email: ${email}. IP: ${req.ip}.`
                );
            }
            return next(
                createHttpError(
                    HttpCode.UNAUTHORIZED,
                    "Username or password is incorrect"
                )
            );
        }

        if (user.type !== UserType.Internal) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Two-factor authentication is not supported for external users"
                )
            );
        }

        if (user.twoFactorEnabled) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Two-factor authentication is already enabled"
                )
            );
        }

        if (!user.twoFactorSecret) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "User has not requested two-factor authentication"
                )
            );
        }

        const valid = await verifyTotpCode(
            code,
            user.twoFactorSecret,
            user.userId
        );

        let codes;
        if (valid) {
            // if valid, enable two-factor authentication; the totp secret is no longer temporary
            await db.transaction(async (trx) => {
                await trx
                    .update(users)
                    .set({
                        twoFactorEnabled: true
                    })
                    .where(eq(users.userId, user.userId));

                const backupCodes = await generateBackupCodes();
                codes = backupCodes;
                for (const code of backupCodes) {
                    const hash = await hashPassword(code);

                    await trx.insert(twoFactorBackupCodes).values({
                        userId: user.userId,
                        codeHash: hash
                    });
                }
            });
        }

        if (!valid) {
            if (config.getRawConfig().app.log_failed_attempts) {
                logger.info(
                    `Two-factor authentication code is incorrect. Email: ${user.email}. IP: ${req.ip}.`
                );
            }
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Invalid two-factor authentication code"
                )
            );
        }

        if (existingSession) {
            await invalidateAllSessionsExceptCurrent(
                user.userId,
                existingSession.sessionId
            );
        } else {
            await invalidateAllSessions(user.userId);
        }

        sendEmail(
            TwoFactorAuthNotification({
                email: user.email!,
                enabled: true
            }),
            {
                to: user.email!,
                from: config.getRawConfig().email?.no_reply,
                subject: "Two-factor authentication enabled"
            }
        );

        return response<VerifyTotpResponse>(res, {
            data: {
                valid,
                ...(valid && codes ? { backupCodes: codes } : {})
            },
            success: true,
            error: false,
            message: valid
                ? "Code is valid. Two-factor is now enabled"
                : "Code is invalid",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to verify two-factor authentication code"
            )
        );
    }
}
