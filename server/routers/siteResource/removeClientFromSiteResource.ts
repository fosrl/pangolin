import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, siteResources, clients, clientSiteResources } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { eq, and } from "drizzle-orm";
import { OpenAPITags, registry } from "@server/openApi";
import {
    rebuildClientAssociationsFromSiteResource,
    isOrgRebuildRateLimited
} from "@server/lib/rebuildClientAssociations";

const removeClientFromSiteResourceBodySchema = z
    .object({
        clientId: z.number().int().positive()
    })
    .strict();

const removeClientFromSiteResourceParamsSchema = z
    .object({
        siteResourceId: z
            .string()
            .transform(Number)
            .pipe(z.number().int().positive())
    })
    .strict();

registry.registerPath({
    method: "post",
    path: "/site-resource/{siteResourceId}/clients/remove",
    description:
        "Remove a single client from a site resource. Clients with a userId cannot be removed.",
    tags: [OpenAPITags.PrivateResource, OpenAPITags.Client],
    request: {
        params: removeClientFromSiteResourceParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: removeClientFromSiteResourceBodySchema
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

export async function removeClientFromSiteResource(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = removeClientFromSiteResourceBodySchema.safeParse(
            req.body
        );
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { clientId } = parsedBody.data;

        const parsedParams = removeClientFromSiteResourceParamsSchema.safeParse(
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
                createHttpError(HttpCode.NOT_FOUND, "Site resource not found")
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
        // Check if client exists and has a userId
        const [client] = await db
            .select()
            .from(clients)
            .where(eq(clients.clientId, clientId))
            .limit(1);

        if (!client) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Client not found")
            );
        }

        if (client.userId !== null) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Cannot remove clients that are associated with a user"
                )
            );
        }

        // Check if client exists in site resource
        const existingEntry = await db
            .select()
            .from(clientSiteResources)
            .where(
                and(
                    eq(clientSiteResources.siteResourceId, siteResourceId),
                    eq(clientSiteResources.clientId, clientId)
                )
            );

        if (existingEntry.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "Client not found in site resource"
                )
            );
        }

        await db
            .delete(clientSiteResources)
            .where(
                and(
                    eq(clientSiteResources.siteResourceId, siteResourceId),
                    eq(clientSiteResources.clientId, clientId)
                )
            );

        rebuildClientAssociationsFromSiteResource(siteResource).catch((e) => {
            logger.error(
                `Failed to rebuild client associations for site resource ${siteResourceId}. Error: ${e}`
            );
        });

        return response(res, {
            data: {},
            success: true,
            error: false,
            message: "Client removed from site resource successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
