import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { users } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";

const bodySchema = z.object({
    locale: z.string().min(2).max(10)
});

export async function updateUserLocale(
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

        const userId = req.user?.userId;
        if (!userId) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "User not found")
            );
        }

        const { locale } = parsedBody.data;

        await db
            .update(users)
            .set({ locale })
            .where(eq(users.userId, userId));

        return response(res, {
            data: { locale },
            success: true,
            error: false,
            message: "Locale updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}