import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { aiModels, db } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { eq } from "drizzle-orm";

const paramsSchema = z.strictObject({
    modelId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "delete",
    path: "/ai-model/{modelId}",
    description: "Delete an AI model.",
    tags: [OpenAPITags.AiModel],
    request: {
        params: paramsSchema
    },
    responses: {
        200: {
            description: "Successful response"
        }
    }
});

export async function deleteAiModel(
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

        const { modelId } = parsedParams.data;

        const [existing] = await db
            .select({ modelId: aiModels.modelId })
            .from(aiModels)
            .where(eq(aiModels.modelId, modelId))
            .limit(1);

        if (!existing) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `AI model with ID ${modelId} not found`
                )
            );
        }

        await db.delete(aiModels).where(eq(aiModels.modelId, modelId));

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "AI model deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
