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
    listPublicResourceAiProviders,
    resolveProviderAttachments,
    setPublicResourceAiProviders
} from "@server/lib/aiInferenceResource";

const removeAiProviderFromResourceBodySchema = z.strictObject({
    providerId: z.number().int().positive()
});

const removeAiProviderFromResourceParamsSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "post",
    path: "/resource/{resourceId}/ai-providers/remove",
    description:
        "Remove an AI provider attachment from an inference resource. At least one provider must remain.",
    tags: [OpenAPITags.PublicResource],
    request: {
        params: removeAiProviderFromResourceParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: removeAiProviderFromResourceBodySchema
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

export async function removeAiProviderFromResource(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = removeAiProviderFromResourceBodySchema.safeParse(
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

        const { providerId } = parsedBody.data;

        const parsedParams = removeAiProviderFromResourceParamsSchema.safeParse(
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

        const existing = await listPublicResourceAiProviders(resourceId);
        const found = existing.find((a) => a.providerId === providerId);
        if (!found) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "AI provider is not attached to this resource"
                )
            );
        }

        const remaining = existing
            .filter((a) => a.providerId !== providerId)
            .map((a) => ({
                providerId: a.providerId,
                accessMode: a.accessMode,
                enabled: a.enabled
            }));

        const attachments = await resolveProviderAttachments({
            orgId: resource.orgId,
            attachments: remaining,
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
            message: "AI provider removed from resource successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
