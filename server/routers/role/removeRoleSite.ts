import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { resources, roleResources, roleSites } from "@server/db";
import { and, eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";

const removeRoleSiteParamsSchema = z.strictObject({
    roleId: z.coerce.number().int().positive()
});

const removeRoleSiteSchema = z.strictObject({
    siteId: z.coerce.number().int().positive()
});

export async function removeRoleSite(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = removeRoleSiteSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { siteId } = parsedParams.data;

        const parsedBody = removeRoleSiteParamsSchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { roleId } = parsedBody.data;

        await db.transaction(async (trx) => {
            const deletedRoleSite = await trx
                .delete(roleSites)
                .where(
                    and(
                        eq(roleSites.roleId, roleId),
                        eq(roleSites.siteId, siteId)
                    )
                )
                .returning();

            if (deletedRoleSite.length === 0) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `Site with ID ${siteId} not found for role with ID ${roleId}`
                    )
                );
            }

            // const siteResources = await db
            //     .select()
            //     .from(resources)
            //     .where(eq(resources.siteId, siteId));
            //
            // for (const resource of siteResources) {
            //     await trx
            //         .delete(roleResources)
            //         .where(
            //             and(
            //                 eq(roleResources.roleId, roleId),
            //                 eq(roleResources.resourceId, resource.resourceId)
            //             )
            //         )
            //         .returning();
            // }
        });

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Site removed from role successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
