import { NextFunction, Request, Response } from "express";
import HttpCode from "@server/types/HttpCode";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import createHttpError from "http-errors";
import { generateId } from "@server/auth/sessions/app";
import logger from "@server/logger";
import { hashPassword } from "@server/auth/password";
import { passwordSchema } from "@server/auth/passwordSchema";
import { response } from "@server/lib/response";
import { db, users, setupTokens } from "@server/db";
import { eq, and } from "drizzle-orm";
import { UserType } from "@server/types/UserTypes";
import moment from "moment";

export const bodySchema = z.object({
    email: z.string().toLowerCase().email(),
    password: passwordSchema,
    setupToken: z.string().min(1, "Setup token is required")
});

export type SetServerAdminBody = z.infer<typeof bodySchema>;

export type SetServerAdminResponse = null;

export async function setServerAdmin(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = bodySchema.safeParse(req.body);

        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { email, password, setupToken } = parsedBody.data;

        // Validate setup token
        const [validToken] = await db
            .select()
            .from(setupTokens)
            .where(
                and(
                    eq(setupTokens.token, setupToken),
                    eq(setupTokens.used, false)
                )
            );

        if (!validToken) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Invalid or expired setup token"
                )
            );
        }

        const [existing] = await db
            .select()
            .from(users)
            .where(eq(users.serverAdmin, true));

        if (existing) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Server admin already exists"
                )
            );
        }

        const passwordHash = await hashPassword(password);
        const userId = generateId(15);

        await db.transaction(async (trx) => {
            // Mark the token as used
            await trx
                .update(setupTokens)
                .set({
                    used: true,
                    dateUsed: moment().toISOString()
                })
                .where(eq(setupTokens.tokenId, validToken.tokenId));

            // Create the server admin user
            await trx.insert(users).values({
                userId: userId,
                email: email,
                type: UserType.Internal,
                username: email,
                passwordHash,
                dateCreated: moment().toISOString(),
                serverAdmin: true,
                emailVerified: true,
                lastPasswordChange: new Date().getTime()
            });
        });

        return response<SetServerAdminResponse>(res, {
            data: null,
            success: true,
            error: false,
            message: "Server admin set successfully",
            status: HttpCode.OK
        });
    } catch (e) {
        logger.error(e);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to set server admin"
            )
        );
    }
}
