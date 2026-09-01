import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, siteResources, siteResourceAiModels } from "@server/db";
import { eq, and } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import {
    assertSiteModelListApiEligible,
    assertSiteResourceModelEntriesValid,
    modelListTypeSchema
} from "@server/lib/aiInferenceResource";

const addAiModelToSiteResourceBodySchema = z.strictObject({
    modelId: z.number().int().positive(),
    listType: modelListTypeSchema.optional().default("allow")
});

const addAiModelToSiteResourceParamsSchema = z.strictObject({
    siteResourceId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "post",
    path: "/site-resource/{siteResourceId}/ai-models/add",
    description:
        "Add a single model to an inference site resource allow/block selection. Requires at least one attached AI provider in select mode. The model must belong to a select-mode provider and its listType must match the provider catalog entry. listType defaults to allow.",
    tags: [OpenAPITags.PrivateResource],
    request: {
        params: addAiModelToSiteResourceParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: addAiModelToSiteResourceBodySchema
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

export async function addAiModelToSiteResource(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = addAiModelToSiteResourceBodySchema.safeParse(
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

        const { modelId, listType } = parsedBody.data;

        const parsedParams = addAiModelToSiteResourceParamsSchema.safeParse(
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

        const eligibleError =
            await assertSiteModelListApiEligible(siteResource);
        if (eligibleError) {
            return next(createHttpError(HttpCode.BAD_REQUEST, eligibleError));
        }

        const modelError = await assertSiteResourceModelEntriesValid({
            orgId: siteResource.orgId,
            siteResourceId,
            models: [{ modelId, listType }]
        });
        if (modelError) {
            return next(createHttpError(HttpCode.BAD_REQUEST, modelError));
        }

        const existingEntry = await db
            .select()
            .from(siteResourceAiModels)
            .where(
                and(
                    eq(siteResourceAiModels.siteResourceId, siteResourceId),
                    eq(siteResourceAiModels.modelId, modelId)
                )
            );

        if (existingEntry.length > 0) {
            return next(
                createHttpError(
                    HttpCode.CONFLICT,
                    "Model already assigned to site resource"
                )
            );
        }

        await db.insert(siteResourceAiModels).values({
            siteResourceId,
            modelId,
            listType
        });

        return response(res, {
            data: {},
            success: true,
            error: false,
            message: "Model added to site resource successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
