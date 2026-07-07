import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
    db,
    clients,
    clientSiteResources,
    siteResources,
    apiKeyOrg,
    primaryDb
} from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { eq, and, inArray } from "drizzle-orm";
import { OpenAPITags, registry } from "@server/openApi";
import {
    rebuildClientAssociationsFromClient,
    isOrgRebuildRateLimited
} from "@server/lib/rebuildClientAssociations";

const batchAddClientToSiteResourcesParamsSchema = z
    .object({
        clientId: z.coerce.number().int().positive()
    })
    .strict();

const batchAddClientToSiteResourcesBodySchema = z
    .object({
        siteResourceIds: z
            .array(z.number().int().positive())
            .min(1, "At least one siteResourceId is required")
    })
    .strict();

registry.registerPath({
    method: "post",
    path: "/client/{clientId}/site-resources",
    description: "Add a machine client to multiple site resources at once.",
    tags: [OpenAPITags.Client],
    request: {
        params: batchAddClientToSiteResourcesParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: batchAddClientToSiteResourcesBodySchema
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

export async function batchAddClientToSiteResources(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const apiKey = req.apiKey;
        if (!apiKey) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "Key not authenticated")
            );
        }

        const parsedParams =
            batchAddClientToSiteResourcesParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const parsedBody = batchAddClientToSiteResourcesBodySchema.safeParse(
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

        const { clientId } = parsedParams.data;
        const { siteResourceIds } = parsedBody.data;
        const uniqueSiteResourceIds = [...new Set(siteResourceIds)];

        const batchSiteResources = await db
            .select()
            .from(siteResources)
            .where(
                inArray(siteResources.siteResourceId, uniqueSiteResourceIds)
            );

        if (batchSiteResources.length !== uniqueSiteResourceIds.length) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "One or more site resources not found"
                )
            );
        }

        if (!apiKey.isRoot) {
            const orgIds = [
                ...new Set(batchSiteResources.map((sr) => sr.orgId))
            ];
            if (orgIds.length > 1) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "All site resources must belong to the same organization"
                    )
                );
            }
            const orgId = orgIds[0];
            const [apiKeyOrgRow] = await db
                .select()
                .from(apiKeyOrg)
                .where(
                    and(
                        eq(apiKeyOrg.apiKeyId, apiKey.apiKeyId),
                        eq(apiKeyOrg.orgId, orgId)
                    )
                )
                .limit(1);

            if (!apiKeyOrgRow) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "Key does not have access to the organization of the specified site resources"
                    )
                );
            }

            const [clientInOrg] = await db
                .select()
                .from(clients)
                .where(
                    and(
                        eq(clients.clientId, clientId),
                        eq(clients.orgId, orgId)
                    )
                )
                .limit(1);

            if (!clientInOrg) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "Key does not have access to the specified client"
                    )
                );
            }
        }

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

        if (await isOrgRebuildRateLimited(client.orgId)) {
            return next(
                createHttpError(
                    HttpCode.TOO_MANY_REQUESTS,
                    "Too many concurrent rebuild operations for this organization. Please retry after a moment."
                )
            );
        }

        if (client.userId !== null) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "This endpoint only supports machine (non-user) clients; the specified client is associated with a user"
                )
            );
        }

        const existingEntries = await db
            .select({
                siteResourceId: clientSiteResources.siteResourceId
            })
            .from(clientSiteResources)
            .where(
                and(
                    eq(clientSiteResources.clientId, clientId),
                    inArray(
                        clientSiteResources.siteResourceId,
                        batchSiteResources.map((sr) => sr.siteResourceId)
                    )
                )
            );

        const existingSiteResourceIds = new Set(
            existingEntries.map((e) => e.siteResourceId)
        );
        const siteResourcesToAdd = batchSiteResources.filter(
            (sr) => !existingSiteResourceIds.has(sr.siteResourceId)
        );

        if (siteResourcesToAdd.length === 0) {
            return next(
                createHttpError(
                    HttpCode.CONFLICT,
                    "Client is already assigned to all specified site resources"
                )
            );
        }

        await db.transaction(async (trx) => {
            for (const siteResource of siteResourcesToAdd) {
                await trx.insert(clientSiteResources).values({
                    clientId,
                    siteResourceId: siteResource.siteResourceId
                });
            }
        });

        rebuildClientAssociationsFromClient(client).catch((e) => {
            logger.error(
                `Failed to rebuild client associations after batch adding site resources for client ${clientId}: ${e}`
            );
        });

        return response(res, {
            data: {
                addedCount: siteResourcesToAdd.length,
                skippedCount:
                    batchSiteResources.length - siteResourcesToAdd.length,
                siteResourceIds: siteResourcesToAdd.map(
                    (sr) => sr.siteResourceId
                )
            },
            success: true,
            error: false,
            message: `Client added to ${siteResourcesToAdd.length} site resource(s) successfully`,
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
