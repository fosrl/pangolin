import { NextFunction, Request, Response } from "express";
import { Client, db, Olm, primaryDb } from "@server/db";
import { olms, clients, clientSitesAssociationsCache } from "@server/db";
import { eq } from "drizzle-orm";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import response from "@server/lib/response";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";
import {
    rebuildClientAssociationsFromClient,
    isOrgRebuildRateLimited
} from "@server/lib/rebuildClientAssociations";
import { sendTerminateClient } from "../client/terminate";
import { OlmErrorCodes } from "./error";

const paramsSchema = z
    .object({
        userId: z.string(),
        olmId: z.string()
    })
    .strict();

// registry.registerPath({
//     method: "delete",
//     path: "/user/{userId}/olm/{olmId}",
//     description: "Delete an olm for a user.",
//     tags: [OpenAPITags.User, OpenAPITags.Client],
//     request: {
//         params: paramsSchema
//     },
// responses: {
// 200: {
// description: "Successful response",
// content: {
// "application/json": {
// schema: z.object({
// data: z.record(z.string(), z.any()).nullable(),
// success: z.boolean(),
// error: z.boolean(),
// message: z.string(),
// status: z.number()
// })
// }
// }
// }
// }
// });

export async function deleteUserOlm(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = paramsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { olmId } = parsedParams.data;

        // get the client first
        const [client] = await db
            .select()
            .from(clients)
            .where(eq(clients.olmId, olmId));

        if (!client) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `No client found for olmId ${olmId}`
                )
            );
        }

        if (await isOrgRebuildRateLimited(client.orgId)) {
            return next(
                createHttpError(
                    HttpCode.TOO_MANY_REQUESTS,
                    "Too many concurrent rebuild operations for this organization. Please retry after a moment."
                )
            );
        }

        let deletedClient: Client | undefined;
        // Delete associated clients and the OLM in a transaction
        await db.transaction(async (trx) => {
            // Find all clients associated with this OLM
            const associatedClients = await trx
                .select({ clientId: clients.clientId })
                .from(clients)
                .where(eq(clients.olmId, olmId));

            // Delete all associated clients
            if (associatedClients.length > 0) {
                [deletedClient] = await trx
                    .delete(clients)
                    .where(eq(clients.olmId, olmId))
                    .returning();
            }

            // Finally, delete the OLM itself
            await trx.delete(olms).where(eq(olms.olmId, olmId)).returning();
        });

        if (deletedClient) {
            rebuildClientAssociationsFromClient(deletedClient).catch((e) => {
                logger.error(
                    `Failed to rebuild client-site associations after deleting OLM ${olmId}: ${e}`
                );
            });
            sendTerminateClient(
                deletedClient.clientId,
                OlmErrorCodes.TERMINATED_DELETED,
                olmId
            ).catch((e) => {
                logger.error(
                    `Failed to send terminate message for client ${deletedClient?.clientId} after deleting OLM ${olmId}: ${e}`
                );
            });
        }

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Device deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to delete device"
            )
        );
    }
}
