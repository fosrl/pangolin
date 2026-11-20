import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, clients, olms } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { sendToClient } from "#dynamic/routers/ws";
import { supportsRestart } from "@server/lib/clientVersionChecks";

const restartClientSchema = z.strictObject({
    clientId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "post",
    path: "/client/{clientId}/restart",
    description:
        "Restart the connection of a connected client. The client tears down its tunnel and connects again.",
    tags: [OpenAPITags.Client],
    request: {
        params: restartClientSchema
    },
    responses: {}
});

export async function restartClient(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = restartClientSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { clientId } = parsedParams.data;

        const [client] = await db
            .select({ online: clients.online })
            .from(clients)
            .where(eq(clients.clientId, clientId))
            .limit(1);

        if (!client) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Client with ID ${clientId} not found`
                )
            );
        }

        const [olm] = await db
            .select({ olmId: olms.olmId, version: olms.version })
            .from(olms)
            .where(eq(olms.clientId, clientId))
            .limit(1);

        if (!olm || !client.online) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Client is not connected")
            );
        }

        if (!supportsRestart(olm.version)) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "This client's version does not support remote restart. Update the client to use this action."
                )
            );
        }

        await sendToClient(olm.olmId, {
            type: "olm/restart",
            data: {}
        });

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Client restart requested",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to restart client"
            )
        );
    }
}
