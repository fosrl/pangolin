import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { clients } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { eq, and, ne } from "drizzle-orm";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";

const updateClientParamsSchema = z.strictObject({
    clientId: z.coerce.number().int().positive()
});

const updateClientSchema = z.strictObject({
    name: z.string().min(1).max(255).optional(),
    niceId: z.string().min(1).max(255).optional()
});

export type UpdateClientBody = z.infer<typeof updateClientSchema>;

registry.registerPath({
    method: "post",
    path: "/client/{clientId}",
    description: "Update a client by its client ID.",
    tags: [OpenAPITags.Client],
    request: {
        params: updateClientParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: updateClientSchema
                }
            }
        }
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

export async function updateClient(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = updateClientSchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { name, niceId } = parsedBody.data;

        const parsedParams = updateClientParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { clientId } = parsedParams.data;

        // Fetch the client to make sure it exists and the user has access to it
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

        // if niceId is provided, check if it's already in use by another client
        if (niceId) {
            const [existingClient] = await db
                .select()
                .from(clients)
                .where(
                    and(
                        eq(clients.niceId, niceId),
                        eq(clients.orgId, clients.orgId),
                        ne(clients.clientId, clientId)
                    )
                )
                .limit(1);

            if (existingClient) {
                return next(
                    createHttpError(
                        HttpCode.CONFLICT,
                        `A client with niceId "${niceId}" already exists`
                    )
                );
            }
        }

        const updatedClient = await db
            .update(clients)
            .set({ name, niceId })
            .where(eq(clients.clientId, clientId))
            .returning();

        return response(res, {
            data: updatedClient,
            success: true,
            error: false,
            message: "Client updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
