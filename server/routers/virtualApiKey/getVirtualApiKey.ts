import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, virtualApiKeyResources, virtualApiKeys } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { eq } from "drizzle-orm";
import { toPublicVirtualApiKey } from "@server/lib/virtualApiKey";
import type { GetVirtualApiKeyResponse } from "@server/routers/virtualApiKey/types";

const paramsSchema = z.strictObject({
    virtualApiKeyId: z.string().nonempty()
});

registry.registerPath({
    method: "get",
    path: "/virtual-api-key/{virtualApiKeyId}",
    description:
        "Get a manual virtual API key by ID, including the decrypted secret.",
    tags: [OpenAPITags.VirtualApiKey],
    request: {
        params: paramsSchema
    },
    responses: {
        200: {
            description: "Successful response"
        }
    }
});

export async function getVirtualApiKey(
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

        const { virtualApiKeyId } = parsedParams.data;

        const [key] =
            req.virtualApiKey &&
            req.virtualApiKey.virtualApiKeyId === virtualApiKeyId
                ? [req.virtualApiKey]
                : await db
                      .select()
                      .from(virtualApiKeys)
                      .where(
                          eq(virtualApiKeys.virtualApiKeyId, virtualApiKeyId)
                      )
                      .limit(1);

        if (!key || key.kind !== "manual") {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Virtual API key with ID ${virtualApiKeyId} not found`
                )
            );
        }

        const resourceRows = await db
            .select({ resourceId: virtualApiKeyResources.resourceId })
            .from(virtualApiKeyResources)
            .where(eq(virtualApiKeyResources.virtualApiKeyId, virtualApiKeyId));

        return response<GetVirtualApiKeyResponse>(res, {
            data: {
                virtualApiKey: {
                    ...toPublicVirtualApiKey(key, { includeSecret: true }),
                    resourceIds: resourceRows.map((row) => row.resourceId)
                }
            },
            success: true,
            error: false,
            message: "Virtual API key retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
