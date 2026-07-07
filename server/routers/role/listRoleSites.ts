import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { roleSites, sites } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";

const listRoleSitesSchema = z.strictObject({
    roleId: z.coerce.number().int().positive()
});

export async function listRoleSites(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = listRoleSitesSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { roleId } = parsedParams.data;

        const roleSitesList = await db
            .select({
                siteId: sites.siteId,
                name: sites.name
            })
            .from(roleSites)
            .innerJoin(sites, eq(roleSites.siteId, sites.siteId))
            .where(eq(roleSites.roleId, roleId));

        // TODO: Do we need to filter out what the user can see?

        return response(res, {
            data: roleSitesList,
            success: true,
            error: false,
            message: "Role sites retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
