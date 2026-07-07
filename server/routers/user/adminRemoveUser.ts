import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, primaryDb } from "@server/db";
import { users } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { calculateUserClientsForOrgs } from "@server/lib/calculateUserClientsForOrgs";

const removeUserSchema = z.strictObject({
    userId: z.string()
});

export async function adminRemoveUser(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = removeUserSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { userId } = parsedParams.data;

        // get the user first
        const user = await db
            .select()
            .from(users)
            .where(eq(users.userId, userId));

        if (!user || user.length === 0) {
            return next(createHttpError(HttpCode.NOT_FOUND, "User not found"));
        }

        if (user[0].serverAdmin) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Cannot remove server admin"
                )
            );
        }

        await db.transaction(async (trx) => {
            await trx.delete(users).where(eq(users.userId, userId));
        });

        calculateUserClientsForOrgs(userId).catch((e) => {
            logger.error(
                `Failed to calculate user clients after removing user ${userId}: ${e}`
            );
        });

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "User removed successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
