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
import { assertSiteModelListApiEligible } from "@server/lib/aiInferenceResource";

const removeAiModelFromSiteResourceBodySchema = z.strictObject({
    modelId: z.int().positive()
});

const removeAiModelFromSiteResourceParamsSchema = z.strictObject({
    siteResourceId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "post",
    path: "/site-resource/{siteResourceId}/ai-models/remove",
    description:
        "Remove a single model from an inference site resource allow/block list. Requires at least one attached AI provider.",
    tags: [OpenAPITags.PrivateResource],
    request: {
        params: removeAiModelFromSiteResourceParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: removeAiModelFromSiteResourceBodySchema
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

export async function removeAiModelFromSiteResource(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = removeAiModelFromSiteResourceBodySchema.safeParse(
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

        const parsedParams =
            removeAiModelFromSiteResourceParamsSchema.safeParse(req.params);
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

        const existingEntry = await db
            .select()
            .from(siteResourceAiModels)
            .where(
                and(
                    eq(siteResourceAiModels.siteResourceId, siteResourceId),
                    eq(siteResourceAiModels.modelId, modelId)
                )
            );

        if (existingEntry.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "Model not found in site resource's restriction list"
                )
            );
        }

        await db
            .delete(siteResourceAiModels)
            .where(
                and(
                    eq(siteResourceAiModels.siteResourceId, siteResourceId),
                    eq(siteResourceAiModels.modelId, modelId)
                )
            );

        return response(res, {
            data: {},
            success: true,
            error: false,
            message: "Model removed from site resource successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
