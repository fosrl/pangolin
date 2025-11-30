import config from "@server/lib/config";
import { Request, Response, NextFunction } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import HttpCode from "@server/types/HttpCode";
import { response } from "@server/lib/response";
import { db } from "@server/db";
import { passwordResetTokens, users } from "@server/db";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "@server/auth/password";
import { verifyTotpCode } from "@server/auth/totp";
import { isWithinExpirationDate } from "oslo";
import { invalidateAllSessions } from "@server/auth/sessions/app";
import logger from "@server/logger";
import ConfirmPasswordReset from "@server/emails/templates/NotifyResetPassword";
import { sendEmail } from "@server/emails";
import { passwordSchema } from "@server/auth/passwordSchema";

export const resetPasswordBody = z
    .object({
        email: z.string().toLowerCase().email(),
        token: z.string(), // reset secret code
        newPassword: passwordSchema,
        code: z.string().optional() // 2fa code
    })
    .strict();

export type ResetPasswordBody = z.infer<typeof resetPasswordBody>;

export type ResetPasswordResponse = {
    codeRequested?: boolean;
};

export async function resetPassword(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const parsedBody = resetPasswordBody.safeParse(req.body);

    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    const { token, newPassword, code, email } = parsedBody.data;

    try {
        const resetRequest = await db
            .select()
            .from(passwordResetTokens)
            .where(eq(passwordResetTokens.email, email));

        if (!resetRequest || !resetRequest.length) {
            if (config.getRawConfig().app.log_failed_attempts) {
                logger.info(
                    `Password reset code is incorrect. Email: ${email}. IP: ${req.ip}.`
                );
            }
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Invalid password reset token"
                )
            );
        }

        if (!isWithinExpirationDate(new Date(resetRequest[0].expiresAt))) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Password reset token has expired"
                )
            );
        }

        const user = await db
            .select()
            .from(users)
            .where(eq(users.userId, resetRequest[0].userId));

        if (!user || !user.length) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "User not found"
                )
            );
        }

        if (user[0].twoFactorEnabled) {
            if (!code) {
                return response<ResetPasswordResponse>(res, {
                    data: { codeRequested: true },
                    success: true,
                    error: false,
                    message: "Two-factor authentication required",
                    status: HttpCode.ACCEPTED
                });
            }

            const validOTP = await verifyTotpCode(
                code!,
                user[0].twoFactorSecret!,
                user[0].userId
            );

            if (!validOTP) {
                if (config.getRawConfig().app.log_failed_attempts) {
                    logger.info(
                        `Two-factor authentication code is incorrect. Email: ${email}. IP: ${req.ip}.`
                    );
                }
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Invalid two-factor authentication code"
                    )
                );
            }
        }

        const isTokenValid = await verifyPassword(
            token,
            resetRequest[0].tokenHash
        );

        if (!isTokenValid) {
            if (config.getRawConfig().app.log_failed_attempts) {
                logger.info(
                    `Password reset code is incorrect. Email: ${email}. IP: ${req.ip}.`
                );
            }
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Invalid password reset token"
                )
            );
        }

        const passwordHash = await hashPassword(newPassword);

        await db.transaction(async (trx) => {
            await trx
                .update(users)
                .set({ passwordHash, lastPasswordChange: new Date().getTime() })
                .where(eq(users.userId, resetRequest[0].userId));

            await trx
                .delete(passwordResetTokens)
                .where(eq(passwordResetTokens.email, email));
        });

        try {
            await invalidateAllSessions(resetRequest[0].userId);
        } catch (e) {
            logger.error("Failed to invalidate user sessions", e);
        }

        try {
            await sendEmail(ConfirmPasswordReset({ email }), {
                from: config.getNoReplyEmail(),
                to: email,
                subject: "Password Reset Confirmation"
            });
        } catch (e) {
            logger.error("Failed to send password reset confirmation email", e);
        }

        return response<ResetPasswordResponse>(res, {
            data: null,
            success: true,
            error: false,
            message: "Password reset successfully",
            status: HttpCode.OK
        });
    } catch (e) {
        logger.error(e);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to reset password"
            )
        );
    }
}
