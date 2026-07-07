import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, siteResources, clients, clientSiteResources } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { eq, inArray } from "drizzle-orm";
import { OpenAPITags, registry } from "@server/openApi";
import {
    rebuildClientAssociationsFromSiteResource,
    isOrgRebuildRateLimited
} from "@server/lib/rebuildClientAssociations";

const setSiteResourceClientsBodySchema = z
    .object({
        clientIds: z.array(z.number().int().positive())
    })
    .strict();

const setSiteResourceClientsParamsSchema = z
    .object({
        siteResourceId: z
            .string()
            .transform(Number)
            .pipe(z.number().int().positive())
    })
    .strict();

registry.registerPath({
    method: "post",
    path: "/site-resource/{siteResourceId}/clients",
    description:
        "Set clients for a site resource. This will replace all existing clients. Clients with a userId cannot be added.",
    tags: [OpenAPITags.PrivateResource, OpenAPITags.Client],
    request: {
        params: setSiteResourceClientsParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: setSiteResourceClientsBodySchema
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

export async function setSiteResourceClients(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = setSiteResourceClientsBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { clientIds } = parsedBody.data;

        const parsedParams = setSiteResourceClientsParamsSchema.safeParse(
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

        // get the site resource
        const [siteResource] = await db
            .select()
            .from(siteResources)
            .where(eq(siteResources.siteResourceId, siteResourceId))
            .limit(1);

        if (!siteResource) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Site resource not found"
                )
            );
        }

        if (await isOrgRebuildRateLimited(siteResource.orgId)) {
            return next(
                createHttpError(
                    HttpCode.TOO_MANY_REQUESTS,
                    "Too many concurrent rebuild operations for this organization. Please retry after a moment."
                )
            );
        }

        // Check if any clients have a userId (associated with a user)
        if (clientIds.length > 0) {
            const clientsWithUsers = await db
                .select()
                .from(clients)
                .where(inArray(clients.clientId, clientIds));

            const clientsWithUserId = clientsWithUsers.filter(
                (client) => client.userId !== null
            );

            if (clientsWithUserId.length > 0) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Cannot add clients that are associated with a user"
                    )
                );
            }
        }

        await db.transaction(async (trx) => {
            await trx
                .delete(clientSiteResources)
                .where(eq(clientSiteResources.siteResourceId, siteResourceId));

            if (clientIds.length > 0) {
                await trx.insert(clientSiteResources).values(
                    clientIds.map((clientId) => ({
                        clientId,
                        siteResourceId
                    }))
                );
            }
        });

        rebuildClientAssociationsFromSiteResource(siteResource).catch((e) => {
            logger.error(
                `Failed to rebuild client associations for site resource ${siteResourceId}. Error: ${e}`
            );
        });

        return response(res, {
            data: {},
            success: true,
            error: false,
            message: "Clients set for site resource successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
