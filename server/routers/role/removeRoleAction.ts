import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { roleActions } from "@server/db";
import { and, eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";

const removeRoleActionParamsSchema = z.strictObject({
    roleId: z.coerce.number().int().positive()
});

const removeRoleActionSchema = z.strictObject({
    actionId: z.string()
});

export async function removeRoleAction(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = removeRoleActionSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { actionId } = parsedParams.data;

        const parsedBody = removeRoleActionParamsSchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { roleId } = parsedBody.data;

        const deletedRoleAction = await db
            .delete(roleActions)
            .where(
                and(
                    eq(roleActions.roleId, roleId),
                    eq(roleActions.actionId, actionId)
                )
            )
            .returning();

        if (deletedRoleAction.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Action with ID ${actionId} not found for role with ID ${roleId}`
                )
            );
        }

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Action removed from role successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
