import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { userResources } from "@server/db";
import { and, eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";

const removeUserResourceSchema = z.strictObject({
    userId: z.string(),
    resourceId: z.coerce.number().int().positive()
});

export async function removeUserResource(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = removeUserResourceSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { userId, resourceId } = parsedParams.data;

        const deletedUserResource = await db
            .delete(userResources)
            .where(
                and(
                    eq(userResources.userId, userId),
                    eq(userResources.resourceId, resourceId)
                )
            )
            .returning();

        if (deletedUserResource.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource with ID ${resourceId} not found for user with ID ${userId}`
                )
            );
        }

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Resource removed from user successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
