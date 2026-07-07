import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { roleResources, resources } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";

const listRoleResourcesSchema = z.strictObject({
    roleId: z.coerce.number().int().positive()
});

export async function listRoleResources(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = listRoleResourcesSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { roleId } = parsedParams.data;

        const roleResourcesList = await db
            .select({
                resourceId: resources.resourceId,
                name: resources.name,
                subdomain: resources.subdomain
            })
            .from(roleResources)
            .innerJoin(
                resources,
                eq(roleResources.resourceId, resources.resourceId)
            )
            .where(eq(roleResources.roleId, roleId));

        // TODO: Do we need to filter out what the user can see?

        return response(res, {
            data: roleResourcesList,
            success: true,
            error: false,
            message: "Role resources retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
