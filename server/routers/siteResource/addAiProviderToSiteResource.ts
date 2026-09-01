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
    listSiteResourceAiProviders,
    resolveProviderAttachments,
    setSiteResourceAiProviders
} from "@server/lib/aiInferenceResource";

const addAiProviderToSiteResourceBodySchema = z.strictObject({
    providerId: z.number().int().positive()
});

const addAiProviderToSiteResourceParamsSchema = z.strictObject({
    siteResourceId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "post",
    path: "/site-resource/{siteResourceId}/ai-providers/add",
    description:
        "Add or replace a single AI provider attachment on an inference site resource. The provider is attached in inherit mode, using its own allow/block lists.",
    tags: [OpenAPITags.PrivateResource],
    request: {
        params: addAiProviderToSiteResourceParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: addAiProviderToSiteResourceBodySchema
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

export async function addAiProviderToSiteResource(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = addAiProviderToSiteResourceBodySchema.safeParse(
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

        const parsedParams = addAiProviderToSiteResourceParamsSchema.safeParse(
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

        const existing = await listSiteResourceAiProviders(siteResourceId);
        const nextAttachments = [
            ...existing
                .filter((a) => a.providerId !== providerId)
                .map((a) => ({
                    providerId: a.providerId,
                    accessMode: a.accessMode,
                    enabled: a.enabled
                })),
            {
                providerId,
                accessMode: "inherit" as const,
                enabled: true as const
            }
        ];

        const attachments = await resolveProviderAttachments({
            orgId: siteResource.orgId,
            attachments: nextAttachments,
            requireAtLeastOne: true
        });
        if (isInferenceFieldsError(attachments)) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, attachments.error)
            );
        }

        await setSiteResourceAiProviders(siteResourceId, attachments);

        return response(res, {
            data: {},
            success: true,
            error: false,
            message: "AI provider added to site resource successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
