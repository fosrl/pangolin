import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, resources } from "@server/db";
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
    setPublicResourceAiProviders
} from "@server/lib/aiInferenceResource";

const setResourceAiProvidersBodySchema = z.strictObject({
    providers: z.array(resourceAiProviderAttachmentSchema)
});

const setResourceAiProvidersParamsSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "post",
    path: "/resource/{resourceId}/ai-providers",
    description:
        "Replace the AI providers attached to an inference resource. Each provider uses accessMode inherit (default, uses the provider's own allow/block lists) or select (uses the resource's selected subset of that provider's catalog). An empty list clears all providers. Effective allow model keys must be unique across attached providers.",
    tags: [OpenAPITags.PublicResource],
    request: {
        params: setResourceAiProvidersParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: setResourceAiProvidersBodySchema
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

export async function setResourceAiProviders(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = setResourceAiProvidersBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { providers } = parsedBody.data;

        const parsedParams = setResourceAiProvidersParamsSchema.safeParse(
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

        if (resource.mode !== "inference") {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "AI providers can only be attached to inference-mode resources"
                )
            );
        }

        const attachments = await resolveProviderAttachments({
            orgId: resource.orgId,
            attachments: providers,
            requireAtLeastOne: false
        });
        if (isInferenceFieldsError(attachments)) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, attachments.error)
            );
        }

        await setPublicResourceAiProviders(resourceId, attachments);

        return response(res, {
            data: {},
            success: true,
            error: false,
            message: "AI providers set for resource successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
