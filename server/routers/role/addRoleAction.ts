import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { roleActions, roles } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { eq } from "drizzle-orm";
import { fromError } from "zod-validation-error";

const addRoleActionParamSchema = z.strictObject({
    roleId: z.coerce.number().int().positive()
});

const addRoleActionSchema = z.strictObject({
    actionId: z.string()
});

export async function addRoleAction(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = addRoleActionSchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { actionId } = parsedBody.data;

        const parsedParams = addRoleActionParamSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { roleId } = parsedParams.data;

        const role = await db
            .select({ orgId: roles.orgId })
            .from(roles)
            .where(eq(roles.roleId, roleId))
            .limit(1);
        if (role.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Role with ID ${roleId} not found`
                )
            );
        }

        const newRoleAction = await db
            .insert(roleActions)
            .values({
                roleId,
                actionId,
                orgId: role[0].orgId!
            })
            .returning();

        return response(res, {
            data: newRoleAction[0],
            success: true,
            error: false,
            message: "Action added to role successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
