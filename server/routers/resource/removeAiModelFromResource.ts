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
import { assertPublicModelListApiEligible } from "@server/lib/aiInferenceResource";

const removeAiModelFromResourceBodySchema = z.strictObject({
    modelId: z.int().positive()
});

const removeAiModelFromResourceParamsSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "post",
    path: "/resource/{resourceId}/ai-models/remove",
    description:
        "Remove a single model from an inference resource allow/block list. Requires at least one attached AI provider.",
    tags: [OpenAPITags.PublicResource],
    request: {
        params: removeAiModelFromResourceParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: removeAiModelFromResourceBodySchema
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

export async function removeAiModelFromResource(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = removeAiModelFromResourceBodySchema.safeParse(
            req.body
        );
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { modelId } = parsedBody.data;

        const parsedParams = removeAiModelFromResourceParamsSchema.safeParse(
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

        const existingEntry = await db
            .select()
            .from(resourceAiModels)
            .where(
                and(
                    eq(resourceAiModels.resourceId, resourceId),
                    eq(resourceAiModels.modelId, modelId)
                )
            );

        if (existingEntry.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "Model not found in resource's restriction list"
                )
            );
        }

        await db
            .delete(resourceAiModels)
            .where(
                and(
                    eq(resourceAiModels.resourceId, resourceId),
                    eq(resourceAiModels.modelId, modelId)
                )
            );

        return response(res, {
            data: {},
            success: true,
            error: false,
            message: "Model removed from resource successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
