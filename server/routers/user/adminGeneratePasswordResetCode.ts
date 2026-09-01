import { Request, Response, NextFunction } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import HttpCode from "@server/types/HttpCode";
import { response } from "@server/lib/response";
import { db } from "@server/db";
import { passwordResetTokens, users } from "@server/db";
import { eq } from "drizzle-orm";
import { alphabet, generateRandomString } from "oslo/crypto";
import { createDate } from "oslo";
import logger from "@server/logger";
import { TimeSpan } from "oslo";
import { hashPassword } from "@server/auth/password";
import { UserType } from "@server/types/UserTypes";
import config from "@server/lib/config";

const adminGeneratePasswordResetCodeSchema = z.strictObject({
    userId: z.string().min(1)
});

export type AdminGeneratePasswordResetCodeBody = z.infer<
    typeof adminGeneratePasswordResetCodeSchema
>;

export type AdminGeneratePasswordResetCodeResponse = {
    token: string;
    email: string;
    url: string;
};

export async function adminGeneratePasswordResetCode(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const parsedParams = adminGeneratePasswordResetCodeSchema.safeParse(
        req.params
    );

    if (!parsedParams.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedParams.error).toString()
            )
        );
    }

    const { userId } = parsedParams.data;

    try {
        const existingUser = await db
            .select()
            .from(users)
            .where(eq(users.userId, userId));

        if (!existingUser || !existingUser.length) {
            return next(createHttpError(HttpCode.NOT_FOUND, "User not found"));
        }

        if (existingUser[0].type !== UserType.Internal) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Password reset codes can only be generated for internal users"
                )
            );
        }

        if (!existingUser[0].email) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "User does not have an email address"
                )
            );
        }

        const token = generateRandomString(8, alphabet("0-9", "A-Z", "a-z"));

        await db.transaction(async (trx) => {
            await trx
                .delete(passwordResetTokens)
                .where(eq(passwordResetTokens.userId, existingUser[0].userId));

            const tokenHash = await hashPassword(token);

            await trx.insert(passwordResetTokens).values({
                userId: existingUser[0].userId,
                email: existingUser[0].email!,
                tokenHash,
                expiresAt: createDate(new TimeSpan(2, "h")).getTime()
            });
        });

        const url = `${config.getRawConfig().app.dashboard_url}/auth/reset-password?email=${encodeURIComponent(existingUser[0].email!)}&token=${token}`;

        logger.info(
            `Admin generated password reset code for user ${existingUser[0].email} (${userId})`
        );

        return response<AdminGeneratePasswordResetCodeResponse>(res, {
            data: {
                token,
                email: existingUser[0].email!,
                url
            },
            success: true,
            error: false,
            message: "Password reset code generated successfully",
            status: HttpCode.OK
        });
    } catch (e) {
        logger.error(e);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to generate password reset code"
            )
        );
    }
}
