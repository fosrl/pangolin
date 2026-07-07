import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { resources, userResources, userSites } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { eq } from "drizzle-orm";
import { fromError } from "zod-validation-error";

const addUserSiteSchema = z.strictObject({
    userId: z.string(),
    siteId: z.coerce.number().int().positive()
});

export async function addUserSite(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = addUserSiteSchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { userId, siteId } = parsedBody.data;

        await db.transaction(async (trx) => {
            const newUserSite = await trx
                .insert(userSites)
                .values({
                    userId,
                    siteId
                })
                .returning();

            // const siteResources = await trx
            //     .select()
            //     .from(resources)
            //     .where(eq(resources.siteId, siteId));
            //
            // for (const resource of siteResources) {
            //     await trx.insert(userResources).values({
            //         userId,
            //         resourceId: resource.resourceId
            //     });
            // }

            return response(res, {
                data: newUserSite[0],
                success: true,
                error: false,
                message: "Site added to user successfully",
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
