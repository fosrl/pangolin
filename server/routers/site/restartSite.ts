import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, newts } from "@server/db";
import { sites } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { sendToClient } from "#dynamic/routers/ws";

const updateSiteParamsSchema = z.strictObject({
    siteId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "post",
    path: "/site/{siteId}/restart",
    description: "Restart a site.",
    tags: [OpenAPITags.Site],
    request: {
        params: updateSiteParamsSchema
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: z.object({
                        data: z.record(z.string(), z.any()).nullable(),
                        success: z.boolean(),
                        error: z.boolean(),
                        message: z.string(),
                        status: z.number()
                    })
                }
            }
        }
    }
});

export async function restartSite(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = updateSiteParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { siteId } = parsedParams.data;

        const [existingSite] = await db
            .select()
            .from(sites)
            .where(eq(sites.siteId, siteId))
            .limit(1);

        if (!existingSite) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Site with ID ${siteId} not found`
                )
            );
        }

        // get the newt

        const [newt] = await db
            .select()
            .from(newts)
            .where(eq(newts.siteId, siteId))
            .limit(1);

        if (!newt) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Newt for site with ID ${siteId} not found`
                )
            );
        }

        logger.info(`Restarting site ${siteId}...`);

        await sendToClient(newt.newtId, {
            type: "newt/wg/restart",
            data: {}
        });

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Site restarted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
