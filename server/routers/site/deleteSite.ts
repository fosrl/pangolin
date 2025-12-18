import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { newts, newtSessions, sites } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { deletePeer } from "../gerbil/peers";
import { fromError } from "zod-validation-error";
import { sendToClient } from "#dynamic/routers/ws";
import { OpenAPITags, registry } from "@server/openApi";

const deleteSiteSchema = z.strictObject({
    siteId: z.string().transform(Number).pipe(z.int().positive())
});

registry.registerPath({
    method: "delete",
    path: "/site/{siteId}",
    description: "Delete a site and all its associated data.",
    tags: [OpenAPITags.Site],
    request: {
        params: deleteSiteSchema
    },
    responses: {}
});

export async function deleteSite(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = deleteSiteSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { siteId } = parsedParams.data;

        const [site] = await db
            .select()
            .from(sites)
            .where(eq(sites.siteId, siteId))
            .limit(1);

        if (!site) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Site with ID ${siteId} not found`
                )
            );
        }

        let deletedNewtId: string | null = null;

        await db.transaction(async (trx) => {
            if (site.pubKey) {
                if (site.type == "wireguard") {
                    await deletePeer(site.exitNodeId!, site.pubKey);
                } else if (site.type == "newt") {
                    // get the newt on the site by querying the newt table for siteId
                    const [deletedNewt] = await trx
                        .delete(newts)
                        .where(eq(newts.siteId, siteId))
                        .returning();
                    if (deletedNewt) {
                        deletedNewtId = deletedNewt.newtId;

                        // delete all of the sessions for the newt
                        await trx
                            .delete(newtSessions)
                            .where(eq(newtSessions.newtId, deletedNewt.newtId));
                    }
                }
            }

            await trx.delete(sites).where(eq(sites.siteId, siteId));
        });

        // Send termination message outside of transaction to prevent blocking
        if (deletedNewtId) {
            const payload = {
                type: `newt/wg/terminate`,
                data: {}
            };
            // Don't await this to prevent blocking the response
            sendToClient(deletedNewtId, payload).catch((error) => {
                logger.error(
                    "Failed to send termination message to newt:",
                    error
                );
            });
        }

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Site deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
