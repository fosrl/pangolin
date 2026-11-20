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
import { createApiSuccessResponses } from "@server/lib/openapi/createApiResponseSchema";
import { verifyClientAssociationsCache as verifyClientAssociationsCacheLib } from "@server/lib/rebuildClientAssociations";

const paramsSchema = z.strictObject({
    clientId: z.string().transform(Number).pipe(z.int().positive())
});

const ids = (description: string) =>
    z.array(z.number().int()).openapi({ description });

const VerifyClientAssociationsCacheResponseDataSchema = z.object({
    clientId: z
        .number()
        .int()
        .openapi({ description: "Numeric ID of the client." }),
    consistent: z.boolean().openapi({
        description:
            "Whether the cached associations match what the client's permissions imply."
    }),
    expectedSiteResourceIds: ids(
        "Private resources the client's permissions say it should have."
    ),
    expectedSiteIds: ids("Sites the client's permissions say it should reach."),
    actualSiteResourceIds: ids("Private resources currently in the cache."),
    actualSiteIds: ids("Sites currently in the cache."),
    missingSiteResourceIds: ids(
        "Private resources that are expected but missing from the cache."
    ),
    extraSiteResourceIds: ids(
        "Private resources in the cache that are not expected."
    ),
    missingSiteIds: ids("Sites that are expected but missing from the cache."),
    extraSiteIds: ids("Sites in the cache that are not expected.")
});

registry.registerPath({
    method: "get",
    path: "/client/{clientId}/verify-associations-cache",
    description:
        "Read-only check of whether the client's site/site-resource association cache matches what the current permissions imply.",
    tags: [OpenAPITags.Client],
    request: {
        params: paramsSchema
    },
    responses: createApiSuccessResponses(
        VerifyClientAssociationsCacheResponseDataSchema
    )
});

export async function verifyClientAssociationsCache(
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

        const report = await verifyClientAssociationsCacheLib(client);

        return response(res, {
            data: report,
            success: true,
            error: false,
            message: report.consistent
                ? "Client association cache is consistent"
                : "Client association cache is INCONSISTENT",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to verify client association cache"
            )
        );
    }
}
