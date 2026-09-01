import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, resources, resourceAiModels, aiModels } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";

const listResourceAiModelsParamsSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive()
});

async function query(resourceId: number) {
    return await db
        .select({
            modelId: aiModels.modelId,
            modelKey: aiModels.modelKey,
            name: aiModels.name,
            providerId: aiModels.providerId,
            enabled: aiModels.enabled,
            listType: resourceAiModels.listType
        })
        .from(resourceAiModels)
        .innerJoin(aiModels, eq(resourceAiModels.modelId, aiModels.modelId))
        .where(eq(resourceAiModels.resourceId, resourceId));
}

export type ListResourceAiModelsResponse = {
    models: NonNullable<Awaited<ReturnType<typeof query>>>;
};

registry.registerPath({
    method: "get",
    path: "/resource/{resourceId}/ai-models",
    description:
        "List the models this resource has selected from its select-mode providers' allow/block lists. Providers in inherit mode are not represented here; they use their own lists.",
    tags: [OpenAPITags.PublicResource],
    request: {
        params: listResourceAiModelsParamsSchema
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

export async function listResourceAiModels(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = listResourceAiModelsParamsSchema.safeParse(
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

        const models = await query(resourceId);

        return response<ListResourceAiModelsResponse>(res, {
            data: { models },
            success: true,
            error: false,
            message: "Resource AI models retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
