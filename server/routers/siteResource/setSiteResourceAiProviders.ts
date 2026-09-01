import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, siteResources } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import {
    isInferenceFieldsError,
    resolveProviderAttachments,
    resourceAiProviderAttachmentSchema,
    setSiteResourceAiProviders as replaceAttachments
} from "@server/lib/aiInferenceResource";

const setSiteResourceAiProvidersBodySchema = z.strictObject({
    providers: z.array(resourceAiProviderAttachmentSchema)
});

const setSiteResourceAiProvidersParamsSchema = z.strictObject({
    siteResourceId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "post",
    path: "/site-resource/{siteResourceId}/ai-providers",
    description:
        "Replace the AI providers attached to an inference site resource. Each provider uses accessMode inherit (default, uses the provider's own allow/block lists) or select (uses the site resource's selected subset of that provider's catalog). An empty list clears all providers. Effective allow model keys must be unique across attached providers.",
    tags: [OpenAPITags.PrivateResource],
    request: {
        params: setSiteResourceAiProvidersParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: setSiteResourceAiProvidersBodySchema
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

export async function setSiteResourceAiProviders(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = setSiteResourceAiProvidersBodySchema.safeParse(
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

        const { providers } = parsedBody.data;

        const parsedParams = setSiteResourceAiProvidersParamsSchema.safeParse(
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

        if (siteResource.mode !== "inference") {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "AI providers can only be attached to inference-mode resources"
                )
            );
        }

        const attachments = await resolveProviderAttachments({
            orgId: siteResource.orgId,
            attachments: providers,
            requireAtLeastOne: false
        });
        if (isInferenceFieldsError(attachments)) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, attachments.error)
            );
        }

        await replaceAttachments(siteResourceId, attachments);

        return response(res, {
            data: {},
            success: true,
            error: false,
            message: "AI providers set for site resource successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
