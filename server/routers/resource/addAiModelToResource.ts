import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, resources, resourceAiModels } from "@server/db";
import { eq, and } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import {
    assertPublicModelListApiEligible,
    assertPublicResourceModelEntriesValid,
    modelListTypeSchema
} from "@server/lib/aiInferenceResource";

const addAiModelToResourceBodySchema = z.strictObject({
    modelId: z.number().int().positive(),
    listType: modelListTypeSchema.optional().default("allow")
});

const addAiModelToResourceParamsSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "post",
    path: "/resource/{resourceId}/ai-models/add",
    description:
        "Add a single model to an inference resource allow/block selection. Requires at least one attached AI provider in select mode. The model must belong to a select-mode provider and its listType must match the provider catalog entry. listType defaults to allow.",
    tags: [OpenAPITags.PublicResource],
    request: {
        params: addAiModelToResourceParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: addAiModelToResourceBodySchema
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

export async function addAiModelToResource(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = addAiModelToResourceBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { modelId, listType } = parsedBody.data;

        const parsedParams = addAiModelToResourceParamsSchema.safeParse(
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

        const modelError = await assertPublicResourceModelEntriesValid({
            orgId: resource.orgId,
            resourceId,
            models: [{ modelId, listType }]
        });
        if (modelError) {
            return next(createHttpError(HttpCode.BAD_REQUEST, modelError));
        }

        const existingEntry = await db
            .select()
            .from(resourceAiModels)
            .where(
                and(
                    eq(resourceAiModels.resourceId, resourceId),
                    eq(resourceAiModels.modelId, modelId)
                )
            );

        if (existingEntry.length > 0) {
            return next(
                createHttpError(
                    HttpCode.CONFLICT,
                    "Model already assigned to resource"
                )
            );
        }

        await db
            .insert(resourceAiModels)
            .values({ resourceId, modelId, listType });

        return response(res, {
            data: {},
            success: true,
            error: false,
            message: "Model added to resource successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
