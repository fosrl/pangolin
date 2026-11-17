import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import logger from "@server/logger";
import { response } from "@server/lib/response";
import { db, users } from "@server/db";
import { eq } from "drizzle-orm";
import {
    createSession,
    generateSessionToken
} from "@server/auth/sessions/app";

const paramsSchema = z.strictObject({
    userId: z.string().nonempty()
});

export type CreateUserSessionResponse = {
    token: string;
    expiresAt: number;
};

export async function createUserSession(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const parsedParams = paramsSchema.safeParse(req.params);
    if (!parsedParams.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedParams.error).toString()
            )
        );
    }

    try {
        const { userId } = parsedParams.data;

        const matchingUsers = await db
            .select()
            .from(users)
            .where(eq(users.userId, userId))
            .limit(2);

        if (matchingUsers.length === 0) {
            return next(createHttpError(HttpCode.NOT_FOUND, "User not found"));
        }

        if (matchingUsers.length > 1) {
            logger.error(
                `Refusing to create session: multiple users found with id ${userId}`
            );
            return next(
                createHttpError(
                    HttpCode.CONFLICT,
                    "Multiple users found with this ID"
                )
            );
        }

        const existingUser = matchingUsers[0];

        const token = generateSessionToken();
        const sess = await createSession(token, existingUser.userId);

        return response<CreateUserSessionResponse>(res, {
            data: { token, expiresAt: sess.expiresAt },
            success: true,
            error: false,
            message: "Session created successfully",
            status: HttpCode.CREATED
        });
    } catch (e) {
        if (createHttpError.isHttpError(e)) {
            return next(e);
        }
        logger.error(e);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to create user session"
            )
        );
    }
}
