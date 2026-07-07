import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { roleSites, roles } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";

const listSiteRolesSchema = z.strictObject({
    siteId: z.coerce.number().int().positive()
});

export async function listSiteRoles(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = listSiteRolesSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { siteId } = parsedParams.data;

        const siteRolesList = await db
            .select({
                roleId: roles.roleId,
                name: roles.name,
                description: roles.description,
                isAdmin: roles.isAdmin
            })
            .from(roleSites)
            .innerJoin(roles, eq(roleSites.roleId, roles.roleId))
            .where(eq(roleSites.siteId, siteId));

        return response(res, {
            data: siteRolesList,
            success: true,
            error: false,
            message: "Site roles retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
