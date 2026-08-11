import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, users } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";

const updateSelfBodySchema = z.strictObject({
    name: z.string().min(1).max(255).optional(),
    username: z.string().min(1).max(255).optional()
});

export async function updateSelf(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<Response | void> {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
            );
        }

        const parsed = updateSelfBodySchema.safeParse(req.body);
        if (!parsed.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsed.error).toString()
                )
            );
        }

        const { name, username } = parsed.data;

        if (!name && !username) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "At least one field is required"
                )
            );
        }

        await db
            .update(users)
            .set({
                ...(name !== undefined && { name }),
                ...(username !== undefined && { username })
            })
            .where(eq(users.userId, userId));

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Profile updated",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to update profile"
            )
        );
    }
}
