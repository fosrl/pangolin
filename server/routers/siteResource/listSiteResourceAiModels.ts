import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, siteResources, siteResourceAiModels, aiModels } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { AiModelSelectionSchema } from "@server/routers/aiProvider/types";
import { createApiSuccessResponses } from "@server/lib/openapi/createApiResponseSchema";

const listSiteResourceAiModelsParamsSchema = z.strictObject({
    siteResourceId: z.coerce.number().int().positive()
});

async function query(siteResourceId: number) {
    return await db
        .select({
            modelId: aiModels.modelId,
            modelKey: aiModels.modelKey,
            name: aiModels.name,
            providerId: aiModels.providerId,
            enabled: aiModels.enabled,
            listType: siteResourceAiModels.listType
        })
        .from(siteResourceAiModels)
        .innerJoin(aiModels, eq(siteResourceAiModels.modelId, aiModels.modelId))
        .where(eq(siteResourceAiModels.siteResourceId, siteResourceId));
}

export type ListSiteResourceAiModelsResponse = z.infer<
    typeof ListSiteResourceAiModelsResponseDataSchema
>;

const ListSiteResourceAiModelsResponseDataSchema = z.object({
    models: z.array(AiModelSelectionSchema)
});

registry.registerPath({
    method: "get",
    path: "/site-resource/{siteResourceId}/ai-models",
    description:
        "List the models this site resource has selected from its select-mode providers' allow/block lists. Providers in inherit mode are not represented here; they use their own lists.",
    tags: [OpenAPITags.PrivateResource],
    request: {
        params: listSiteResourceAiModelsParamsSchema
    },
    responses: createApiSuccessResponses(
        ListSiteResourceAiModelsResponseDataSchema
    )
});

export async function listSiteResourceAiModels(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = listSiteResourceAiModelsParamsSchema.safeParse(
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

        const { siteResourceId } = parsedParams.data;

        const [siteResource] = await db
            .select()
            .from(siteResources)
            .where(eq(siteResources.siteResourceId, siteResourceId))
            .limit(1);

        if (!siteResource) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Site resource not found")
            );
        }

        const models = await query(siteResourceId);

        return response<ListSiteResourceAiModelsResponse>(res, {
            data: { models },
            success: true,
            error: false,
            message: "Site resource AI models retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
