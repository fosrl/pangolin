import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { listCatalogModelsForType } from "@server/lib/aiModelCatalog";
import type { ListCatalogModelsResponse } from "@server/routers/aiProvider/types";
import { aiProviderTypeSchema } from "@server/routers/aiProvider/validation";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty()
});

const querySchema = z.strictObject({
    type: aiProviderTypeSchema,
    query: z.string().optional()
});

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/ai-catalog-models",
    description:
        "List known catalog models for an AI provider type. Used for model key suggestions before a provider exists.",
    tags: [OpenAPITags.AiModel],
    request: {
        params: paramsSchema,
        query: querySchema
    },
    responses: {
        200: {
            description: "Successful response"
        }
    }
});

export async function listCatalogModelsByType(
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

        const parsedQuery = querySchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error).toString()
                )
            );
        }

        const { type, query } = parsedQuery.data;
        const models = listCatalogModelsForType(type, query);

        return response<ListCatalogModelsResponse>(res, {
            data: { models },
            success: true,
            error: false,
            message: "Catalog models retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
