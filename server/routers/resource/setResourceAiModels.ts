import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, resources, resourceAiModels } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import {
    assertPublicModelListApiEligible,
    assertPublicResourceModelEntriesValid,
    resourceAiModelEntrySchema
} from "@server/lib/aiInferenceResource";

const setResourceAiModelsBodySchema = z.strictObject({
    models: z.array(resourceAiModelEntrySchema)
});

const setResourceAiModelsParamsSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "post",
    path: "/resource/{resourceId}/ai-models",
    description:
        "Replace the allow/block model selection for an inference resource. Requires at least one attached AI provider in select mode. Models must belong to a select-mode provider and their listType must match the provider catalog entry. An empty array clears the selection, which denies all models for select-mode providers.",
    tags: [OpenAPITags.PublicResource],
    request: {
        params: setResourceAiModelsParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: setResourceAiModelsBodySchema
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

export async function setResourceAiModels(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = setResourceAiModelsBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { models } = parsedBody.data;

        const parsedParams = setResourceAiModelsParamsSchema.safeParse(
            req.params
        );
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { resourceId } = parsedParams.data;

        const [resource] = await db
            .select()
            .from(resources)
            .where(eq(resources.resourceId, resourceId))
            .limit(1);

        if (!resource) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Resource not found")
            );
        }

        const eligibleError = await assertPublicModelListApiEligible(resource);
        if (eligibleError) {
            return next(createHttpError(HttpCode.BAD_REQUEST, eligibleError));
        }

        const byModelId = new Map(
            models.map((m) => [m.modelId, m.listType] as const)
        );
        const uniqueModels = [...byModelId.entries()].map(
            ([modelId, listType]) => ({ modelId, listType })
        );

        const modelError = await assertPublicResourceModelEntriesValid({
            orgId: resource.orgId,
            resourceId,
            models: uniqueModels
        });
        if (modelError) {
            return next(createHttpError(HttpCode.BAD_REQUEST, modelError));
        }

        await db.transaction(async (trx) => {
            await trx
                .delete(resourceAiModels)
                .where(eq(resourceAiModels.resourceId, resourceId));

            if (uniqueModels.length > 0) {
                await trx.insert(resourceAiModels).values(
                    uniqueModels.map((m) => ({
                        resourceId,
                        modelId: m.modelId,
                        listType: m.listType
                    }))
                );
            }
        });

        return response(res, {
            data: {},
            success: true,
            error: false,
            message: "AI models set for resource successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
