import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { roleResources } from "@server/db";
import { and, eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";

const removeRoleResourceParamsSchema = z.strictObject({
    roleId: z.coerce.number().int().positive()
});

const removeRoleResourceSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive()
});

export async function removeRoleResource(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = removeRoleResourceSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { resourceId } = parsedParams.data;

        const parsedBody = removeRoleResourceParamsSchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { roleId } = parsedBody.data;

        const deletedRoleResource = await db
            .delete(roleResources)
            .where(
                and(
                    eq(roleResources.roleId, roleId),
                    eq(roleResources.resourceId, resourceId)
                )
            )
            .returning();

        if (deletedRoleResource.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource with ID ${resourceId} not found for role with ID ${roleId}`
                )
            );
        }

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Resource removed from role successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
