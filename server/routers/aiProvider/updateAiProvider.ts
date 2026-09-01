import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { aiProviders, db } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { eq, ne, and } from "drizzle-orm";
import { encrypt } from "@server/lib/crypto";
import config from "@server/lib/config";
import type { CreateOrEditAiProviderResponse } from "@server/routers/aiProvider/types";
import { toPublicAiProvider } from "@server/routers/aiProvider/types";
import {
    aiAuthTypeSchema,
    aiCapabilitiesSchema,
    aiProviderHeadersSchema,
    aiProviderTypeSchema,
    aiRoutingModeSchema,
    refineProviderUpstreamFields
} from "@server/routers/aiProvider/validation";
import {
    serializeAiProviderHeaders,
    type AiProviderAuthType,
    type AiProviderRoutingMode,
    type AiProviderType
} from "@server/lib/aiProviderDefaults";
import {
    parseCapabilities,
    serializeCapabilities
} from "@server/lib/aiCapabilities";

const paramsSchema = z.strictObject({
    providerId: z.coerce.number().int().positive()
});

const bodySchema = z.strictObject({
    name: z.string().nonempty().optional(),
    niceId: z
        .string()
        .min(1)
        .max(255)
        .regex(
            /^[a-zA-Z0-9-]+$/,
            "niceId can only contain letters, numbers, and dashes"
        )
        .optional(),
    upstreamUrl: z.url().optional().nullable(),
    apiKey: z.string().optional(),
    authType: aiAuthTypeSchema.optional(),
    routingMode: aiRoutingModeSchema.optional(),
    capabilities: aiCapabilitiesSchema.optional(),
    headers: aiProviderHeadersSchema,
    skipTlsVerification: z.boolean().optional(),
    enabled: z.boolean().optional()
});

registry.registerPath({
    method: "post",
    path: "/ai-provider/{providerId}",
    description: "Update an AI provider.",
    tags: [OpenAPITags.AiProvider],
    request: {
        params: paramsSchema,
        body: {
            content: {
                "application/json": {
                    schema: bodySchema
                }
            }
        }
    },
    responses: {
        200: {
            description: "Successful response"
        }
    }
});

export async function updateAiProvider(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = paramsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { providerId } = parsedParams.data;
        const body = parsedBody.data;

        const [existing] =
            req.aiProvider && req.aiProvider.providerId === providerId
                ? [req.aiProvider]
                : await db
                      .select()
                      .from(aiProviders)
                      .where(eq(aiProviders.providerId, providerId))
                      .limit(1);

        if (!existing) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `AI provider with ID ${providerId} not found`
                )
            );
        }

        const providerType = existing.type as AiProviderType;
        const nextRoutingMode: AiProviderRoutingMode =
            providerType === "custom"
                ? ((body.routingMode ??
                      existing.routingMode) as AiProviderRoutingMode)
                : "url";
        const nextUpstreamUrl =
            body.upstreamUrl !== undefined
                ? body.upstreamUrl
                : existing.upstreamUrl;
        const nextAuthType: AiProviderAuthType =
            body.authType !== undefined
                ? body.authType
                : (existing.authType as AiProviderAuthType);

        const nextCapabilities =
            body.capabilities !== undefined
                ? body.capabilities
                : parseCapabilities(existing.capabilities);

        const validation = z
            .object({
                type: aiProviderTypeSchema,
                upstreamUrl: z.string().nullable().optional(),
                authType: aiAuthTypeSchema,
                routingMode: aiRoutingModeSchema.optional(),
                capabilities: aiCapabilitiesSchema.optional()
            })
            .superRefine((data, ctx) => refineProviderUpstreamFields(data, ctx))
            .safeParse({
                type: providerType,
                upstreamUrl: nextUpstreamUrl,
                authType: nextAuthType,
                routingMode: nextRoutingMode,
                capabilities: nextCapabilities
            });

        if (!validation.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(validation.error).toString()
                )
            );
        }

        const updateData: Partial<typeof aiProviders.$inferInsert> = {
            updatedAt: Date.now(),
            routingMode: nextRoutingMode
        };

        if (body.name !== undefined) {
            updateData.name = body.name;
        }
        if (body.niceId !== undefined) {
            updateData.niceId = body.niceId;
        }
        if (body.skipTlsVerification !== undefined) {
            updateData.skipTlsVerification = body.skipTlsVerification;
        }
        if (body.enabled !== undefined) {
            updateData.enabled = body.enabled;
        }
        if (nextRoutingMode === "target") {
            updateData.upstreamUrl = null;
        } else if (body.upstreamUrl !== undefined) {
            updateData.upstreamUrl = body.upstreamUrl;
        }
        if (body.authType !== undefined) {
            updateData.authType = body.authType;
        }
        if (body.capabilities !== undefined) {
            updateData.capabilities = serializeCapabilities(body.capabilities);
        }

        if (body.apiKey !== undefined) {
            const key = config.getRawConfig().server.secret!;
            updateData.apiKey = encrypt(body.apiKey, key);
            updateData.apiKeyLastChars = body.apiKey.slice(-4);
        }

        if (body.headers !== undefined) {
            const key = config.getRawConfig().server.secret!;
            updateData.headers = serializeAiProviderHeaders(body.headers, key);
        }

        if (updateData.niceId) {
            const [existingAiProvider] = await db
                .select()
                .from(aiProviders)
                .where(
                    and(
                        eq(aiProviders.niceId, updateData.niceId),
                        eq(aiProviders.orgId, existing.orgId),
                        ne(aiProviders.providerId, existing.providerId) // exclude the current provider from the search
                    )
                )
                .limit(1);

            if (existingAiProvider) {
                return next(
                    createHttpError(
                        HttpCode.CONFLICT,
                        `A resource with niceId "${updateData.niceId}" already exists`
                    )
                );
            }
        }

        const [provider] = await db
            .update(aiProviders)
            .set(updateData)
            .where(eq(aiProviders.providerId, providerId))
            .returning();

        return response<CreateOrEditAiProviderResponse>(res, {
            data: {
                provider: toPublicAiProvider(provider, { includeApiKey: true })
            },
            success: true,
            error: false,
            message: "AI provider updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
