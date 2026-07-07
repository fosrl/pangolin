import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { roleActions, actions } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";

const listRoleActionsSchema = z.strictObject({
    roleId: z.coerce.number().int().positive()
});

export async function listRoleActions(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = listRoleActionsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { roleId } = parsedParams.data;

        const roleActionsList = await db
            .select({
                actionId: actions.actionId,
                name: actions.name,
                description: actions.description
            })
            .from(roleActions)
            .innerJoin(actions, eq(roleActions.actionId, actions.actionId))
            .where(eq(roleActions.roleId, roleId));

        // TODO: Do we need to filter out what the user can see?

        return response(res, {
            data: roleActionsList,
            success: true,
            error: false,
            message: "Role actions retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
