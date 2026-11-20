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
import { sendTerminateClient } from "./terminate";
import { OlmErrorCodes } from "../olm/error";

const disconnectClientSchema = z.strictObject({
    clientId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "post",
    path: "/client/{clientId}/disconnect",
    description:
        "Disconnect a connected client. The client stops its tunnel and does not reconnect until it is started again.",
    tags: [OpenAPITags.Client],
    request: {
        params: disconnectClientSchema
    },
    responses: {}
});

export async function disconnectClient(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = disconnectClientSchema.safeParse(req.params);
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
            .select({ olmId: olms.olmId })
            .from(olms)
            .where(eq(olms.clientId, clientId))
            .limit(1);

        if (!olm || !client.online) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Client is not connected")
            );
        }

        // olm/terminate is understood by every olm version, so a disconnect
        // works without a client upgrade.
        await sendTerminateClient(
            clientId,
            OlmErrorCodes.TERMINATED_DISCONNECTED,
            olm.olmId
        );

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Client disconnected successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to disconnect client"
            )
        );
    }
}
