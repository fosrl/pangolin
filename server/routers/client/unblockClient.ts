import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { clients } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";

const unblockClientSchema = z.strictObject({
    clientId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "post",
    path: "/client/{clientId}/unblock",
    description: "Unblock a client by its client ID.",
    tags: [OpenAPITags.Client],
    request: {
        params: unblockClientSchema
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

export async function unblockClient(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = unblockClientSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { clientId } = parsedParams.data;

        // Check if client exists
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

        if (!client.blocked) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    `Client with ID ${clientId} is not blocked`
                )
            );
        }

        // Unblock the client
        await db
            .update(clients)
            .set({ blocked: false, approvalState: null })
            .where(eq(clients.clientId, clientId));

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Client unblocked successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to unblock client"
            )
        );
    }
}
