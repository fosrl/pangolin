import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { resources, roleResources, roleSites } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { eq } from "drizzle-orm";
import { fromError } from "zod-validation-error";

const addRoleSiteParamsSchema = z.strictObject({
    roleId: z.coerce.number().int().positive()
});

const addRoleSiteSchema = z.strictObject({
    siteId: z.coerce.number().int().positive()
});

export async function addRoleSite(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = addRoleSiteSchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { siteId } = parsedBody.data;

        const parsedParams = addRoleSiteParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { roleId } = parsedParams.data;

        await db.transaction(async (trx) => {
            const newRoleSite = await trx
                .insert(roleSites)
                .values({
                    roleId,
                    siteId
                })
                .returning();

            // const siteResources = await db
            //     .select()
            //     .from(resources)
            //     .where(eq(resources.siteId, siteId));
            //
            // for (const resource of siteResources) {
            //     await trx.insert(roleResources).values({
            //         roleId,
            //         resourceId: resource.resourceId
            //     });
            // }
            //
            return response(res, {
                data: newRoleSite[0],
                success: true,
                error: false,
                message: "Site added to role successfully",
                status: HttpCode.CREATED
            });
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
