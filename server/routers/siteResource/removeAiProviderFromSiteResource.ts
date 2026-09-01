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

const removeAiProviderFromSiteResourceBodySchema = z.strictObject({
    providerId: z.number().int().positive()
});

const removeAiProviderFromSiteResourceParamsSchema = z.strictObject({
    siteResourceId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "post",
    path: "/site-resource/{siteResourceId}/ai-providers/remove",
    description:
        "Remove an AI provider attachment from an inference site resource. At least one provider must remain.",
    tags: [OpenAPITags.PrivateResource],
    request: {
        params: removeAiProviderFromSiteResourceParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: removeAiProviderFromSiteResourceBodySchema
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

export async function removeAiProviderFromSiteResource(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = removeAiProviderFromSiteResourceBodySchema.safeParse(
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

        const parsedParams =
            removeAiProviderFromSiteResourceParamsSchema.safeParse(req.params);
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
        const found = existing.find((a) => a.providerId === providerId);
        if (!found) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "AI provider is not attached to this site resource"
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
            orgId: siteResource.orgId,
            attachments: remaining,
            requireAtLeastOne: false
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
            message: "AI provider removed from site resource successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
