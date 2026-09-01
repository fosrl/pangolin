import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, virtualApiKeys } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { eq } from "drizzle-orm";

const paramsSchema = z.strictObject({
    virtualApiKeyId: z.string().nonempty()
});

registry.registerPath({
    method: "delete",
    path: "/virtual-api-key/{virtualApiKeyId}",
    description: "Delete a manual virtual API key.",
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

export async function deleteVirtualApiKey(
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

        const [existing] =
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

        if (!existing || existing.kind !== "manual") {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Virtual API key with ID ${virtualApiKeyId} not found`
                )
            );
        }

        await db
            .delete(virtualApiKeys)
            .where(eq(virtualApiKeys.virtualApiKeyId, virtualApiKeyId));

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Virtual API key deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
