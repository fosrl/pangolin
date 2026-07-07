import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { clientSiteResources, clients } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";

const listSiteResourceClientsSchema = z
    .object({
        siteResourceId: z
            .string()
            .transform(Number)
            .pipe(z.number().int().positive())
    })
    .strict();

async function queryClients(siteResourceId: number) {
    return await db
        .select({
            clientId: clientSiteResources.clientId,
            name: clients.name,
            subnet: clients.subnet
        })
        .from(clientSiteResources)
        .innerJoin(clients, eq(clientSiteResources.clientId, clients.clientId))
        .where(eq(clientSiteResources.siteResourceId, siteResourceId));
}

export type ListSiteResourceClientsResponse = {
    clients: NonNullable<Awaited<ReturnType<typeof queryClients>>>;
};

registry.registerPath({
    method: "get",
    path: "/site-resource/{siteResourceId}/clients",
    description: "List all clients for a site resource.",
    tags: [OpenAPITags.PrivateResource, OpenAPITags.Client],
    request: {
        params: listSiteResourceClientsSchema
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

export async function listSiteResourceClients(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = listSiteResourceClientsSchema.safeParse(
            req.params
        );
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { siteResourceId } = parsedParams.data;

        const siteResourceClientsList = await queryClients(siteResourceId);

        return response<ListSiteResourceClientsResponse>(res, {
            data: {
                clients: siteResourceClientsList
            },
            success: true,
            error: false,
            message: "Site resource clients retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
