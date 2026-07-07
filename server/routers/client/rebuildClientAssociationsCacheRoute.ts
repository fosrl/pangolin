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
import { rebuildClientAssociationsFromClient, isOrgRebuildRateLimited } from "@server/lib/rebuildClientAssociations";

const paramsSchema = z.strictObject({
    clientId: z.string().transform(Number).pipe(z.int().positive())
});

registry.registerPath({
    method: "post",
    path: "/client/{clientId}/rebuild-associations-cache",
    description:
        "Rebuild the client's site/site-resource association cache based on current permissions.",
    tags: [OpenAPITags.Client],
    request: {
        params: paramsSchema
    },
    responses: {}
});

export async function rebuildClientAssociationsCacheRoute(
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

        rebuildClientAssociationsFromClient(client).catch((e) => {
            logger.error(
                `Failed to rebuild client associations for client ${clientId}: ${e}`
            );
        });

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Client association cache queued successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to rebuild client association cache"
            )
        );
    }
}
