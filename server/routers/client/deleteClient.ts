import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, olms, primaryDb, Client, Olm } from "@server/db";
import { clients, clientSitesAssociationsCache } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import {
    rebuildClientAssociationsFromClient,
    isOrgRebuildRateLimited
} from "@server/lib/rebuildClientAssociations";
import { sendTerminateClient } from "./terminate";
import { OlmErrorCodes } from "../olm/error";
import { LimitId } from "@server/lib/billing/features";
import { usageService } from "@server/lib/billing/usageService";

const deleteClientSchema = z.strictObject({
    clientId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "delete",
    path: "/client/{clientId}",
    description: "Delete a client by its client ID.",
    tags: [OpenAPITags.Client],
    request: {
        params: deleteClientSchema
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

export async function deleteClient(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = deleteClientSchema.safeParse(req.params);
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
            .select()
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

        if (await isOrgRebuildRateLimited(client.orgId)) {
            return next(
                createHttpError(
                    HttpCode.TOO_MANY_REQUESTS,
                    "Too many concurrent rebuild operations for this organization. Please retry after a moment."
                )
            );
        }

        // Only allow deletion of machine clients (clients without userId)
        if (client.userId) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    `Cannot delete a user client. User clients must be archived instead.`
                )
            );
        }

        let deletedClient: Client | undefined;
        let olm: Olm | undefined;

        await db.transaction(async (trx) => {
            // Then delete the client itself
            [deletedClient] = await trx
                .delete(clients)
                .where(eq(clients.clientId, clientId))
                .returning();

            [olm] = await trx
                .select()
                .from(olms)
                .where(eq(olms.clientId, clientId))
                .limit(1);

            // this is a machine client so we also delete the olm
            if (!client.userId && client.olmId) {
                await trx.delete(olms).where(eq(olms.olmId, client.olmId));
            }

            await usageService.add(
                deletedClient.orgId,
                LimitId.MACHINE_CLIENTS,
                -1,
                trx
            );
        });

        if (deletedClient) {
            rebuildClientAssociationsFromClient(deletedClient).catch((e) => {
                logger.error(
                    `Failed to rebuild client associations after deleting client ${clientId}: ${e}`
                );
            });
            if (olm) {
                sendTerminateClient(
                    deletedClient.clientId,
                    OlmErrorCodes.TERMINATED_DELETED,
                    olm.olmId
                ).catch((e) => {
                    logger.error(
                        `Failed to send terminate message for client ${deletedClient?.clientId} after deleting client ${clientId}: ${e}`
                    );
                });
            }
        }

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Client deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
