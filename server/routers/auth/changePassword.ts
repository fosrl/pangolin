import { Request, Response, NextFunction } from "express";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { fromError } from "zod-validation-error";
import { z } from "zod";
import { db } from "@server/db";
import { User, users } from "@server/db";
import { response } from "@server/lib/response";
import { hashPassword, verifyPassword } from "@server/auth/password";
import { verifyTotpCode } from "@server/auth/totp";
import logger from "@server/logger";
import { unauthorized } from "@server/auth/unauthorizedResponse";
import { invalidateAllSessionsExceptCurrent } from "@server/auth/sessions/app";
import { eq } from "drizzle-orm";
import { passwordSchema } from "@server/auth/passwordSchema";
import { UserType } from "@server/types/UserTypes";
import { sendEmail } from "@server/emails";
import ConfirmPasswordReset from "@server/emails/templates/NotifyResetPassword";
import config from "@server/lib/config";

export const changePasswordBody = z.strictObject({
    oldPassword: z.string(),
    newPassword: passwordSchema,
    code: z.string().optional()
});

export type ChangePasswordBody = z.infer<typeof changePasswordBody>;

export type ChangePasswordResponse = {
    codeRequested?: boolean;
};

export async function changePassword(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const parsedBody = changePasswordBody.safeParse(req.body);

    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    const { newPassword, oldPassword, code } = parsedBody.data;
    const user = req.user as User;

    if (user.type !== UserType.Internal) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                "Two-factor authentication is not supported for external users"
            )
        );
    }

    try {
        if (newPassword === oldPassword) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "New password cannot be the same as the old password"
                )
            );
        }

        const validPassword = await verifyPassword(
            oldPassword,
            user.passwordHash!
        );
        if (!validPassword) {
            return next(unauthorized());
        }

        if (user.twoFactorEnabled) {
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
                code!,
                user.twoFactorSecret!,
                user.userId
            );

            if (!validOTP) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "The two-factor code you entered is incorrect"
                    )
                );
            }
        }

        const hash = await hashPassword(newPassword);

        await db
            .update(users)
            .set({
                passwordHash: hash,
                lastPasswordChange: new Date().getTime()
            })
            .where(eq(users.userId, user.userId));

        // Invalidate all sessions except the current one
        await invalidateAllSessionsExceptCurrent(
            user.userId,
            req.session.sessionId
        );

        try {
            const email = user.email!;
            await sendEmail(ConfirmPasswordReset({ email }), {
                from: config.getNoReplyEmail(),
                to: email,
                subject: "Password Reset Confirmation"
            });
        } catch (e) {
            logger.error("Failed to send password reset confirmation email", e);
        }

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Password changed successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to authenticate user"
            )
        );
    }
}
