import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { apiKeys } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";

const paramsSchema = z.object({
    apiKeyId: z.string().nonempty()
});

registry.registerPath({
    method: "delete",
    path: "/org/{orgId}/api-key/{apiKeyId}",
    description: "Delete an API key.",
    tags: [OpenAPITags.ApiKey],
    request: {
        params: paramsSchema
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

export async function deleteApiKey(
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

        const { apiKeyId } = parsedParams.data;

        const [apiKey] = await db
            .select()
            .from(apiKeys)
            .where(eq(apiKeys.apiKeyId, apiKeyId))
            .limit(1);

        if (!apiKey) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `API Key with ID ${apiKeyId} not found`
                )
            );
        }

        await db.delete(apiKeys).where(eq(apiKeys.apiKeyId, apiKeyId));

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "API key deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
