import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { aiModels, aiProviders, db } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, eq } from "drizzle-orm";
import type { CreateOrEditAiModelResponse } from "@server/routers/aiProvider/types";
import { modelListTypeSchema } from "@server/lib/aiInferenceResource";

const paramsSchema = z.strictObject({
    providerId: z.coerce.number().int().positive()
});

const bodySchema = z.strictObject({
    modelKey: z.string().nonempty(),
    name: z.string().nonempty(),
    enabled: z.boolean().optional(),
    listType: modelListTypeSchema.optional().default("allow")
});

registry.registerPath({
    method: "put",
    path: "/ai-provider/{providerId}/model",
    description: "Create an AI model under a provider.",
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
        201: {
            description: "Successful response"
        }
    }
});

export async function createAiModel(
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

        const { providerId } = parsedParams.data;
        const { modelKey, name, enabled, listType } = parsedBody.data;

        const [provider] =
            req.aiProvider && req.aiProvider.providerId === providerId
                ? [req.aiProvider]
                : await db
                      .select()
                      .from(aiProviders)
                      .where(eq(aiProviders.providerId, providerId))
                      .limit(1);

        if (!provider) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `AI provider with ID ${providerId} not found`
                )
            );
        }

        const [existing] = await db
            .select({ modelId: aiModels.modelId })
            .from(aiModels)
            .where(
                and(
                    eq(aiModels.providerId, providerId),
                    eq(aiModels.modelKey, modelKey)
                )
            )
            .limit(1);

        if (existing) {
            return next(
                createHttpError(
                    HttpCode.CONFLICT,
                    `Model with key ${modelKey} already exists for this provider`
                )
            );
        }

        const now = Date.now();
        const [model] = await db
            .insert(aiModels)
            .values({
                providerId,
                modelKey,
                name,
                listType,
                enabled: enabled ?? true,
                createdAt: now,
                updatedAt: now
            })
            .returning();

        return response<CreateOrEditAiModelResponse>(res, {
            data: { model },
            success: true,
            error: false,
            message: "AI model created successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
