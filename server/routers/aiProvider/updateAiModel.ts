import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { aiModels, db } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, eq, ne } from "drizzle-orm";
import type { CreateOrEditAiModelResponse } from "@server/routers/aiProvider/types";
import { modelListTypeSchema } from "@server/lib/aiInferenceResource";

const paramsSchema = z.strictObject({
    modelId: z.coerce.number().int().positive()
});

const bodySchema = z.strictObject({
    modelKey: z.string().nonempty().optional(),
    name: z.string().nonempty().optional(),
    enabled: z.boolean().optional(),
    listType: modelListTypeSchema.optional()
});

registry.registerPath({
    method: "post",
    path: "/ai-model/{modelId}",
    description: "Update an AI model.",
    tags: [OpenAPITags.AiModel],
    request: {
        params: paramsSchema,
        body: {
            content: {
                "application/json": {
                    schema: bodySchema
                }
            }
        }
    },
    responses: {
        200: {
            description: "Successful response"
        }
    }
});

export async function updateAiModel(
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

        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { modelId } = parsedParams.data;
        const body = parsedBody.data;

        const [existing] =
            req.aiModel && req.aiModel.modelId === modelId
                ? [req.aiModel]
                : await db
                      .select()
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

        if (
            body.modelKey !== undefined &&
            body.modelKey !== existing.modelKey
        ) {
            const [conflict] = await db
                .select({ modelId: aiModels.modelId })
                .from(aiModels)
                .where(
                    and(
                        eq(aiModels.providerId, existing.providerId),
                        eq(aiModels.modelKey, body.modelKey),
                        ne(aiModels.modelId, modelId)
                    )
                )
                .limit(1);

            if (conflict) {
                return next(
                    createHttpError(
                        HttpCode.CONFLICT,
                        `Model with key ${body.modelKey} already exists for this provider`
                    )
                );
            }
        }

        const updateData: Partial<typeof aiModels.$inferInsert> = {
            updatedAt: Date.now()
        };

        if (body.modelKey !== undefined) {
            updateData.modelKey = body.modelKey;
        }
        if (body.name !== undefined) {
            updateData.name = body.name;
        }
        if (body.enabled !== undefined) {
            updateData.enabled = body.enabled;
        }
        if (body.listType !== undefined) {
            updateData.listType = body.listType;
        }

        const [model] = await db
            .update(aiModels)
            .set(updateData)
            .where(eq(aiModels.modelId, modelId))
            .returning();

        return response<CreateOrEditAiModelResponse>(res, {
            data: { model },
            success: true,
            error: false,
            message: "AI model updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
