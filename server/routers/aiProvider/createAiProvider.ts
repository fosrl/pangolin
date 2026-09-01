import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { aiProviders, db } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { encrypt } from "@server/lib/crypto";
import config from "@server/lib/config";
import {
    resolveAiProviderCreateFields,
    resolveCapabilitiesForCreate,
    serializeAiProviderHeaders
} from "@server/lib/aiProviderDefaults";
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
import { serializeCapabilities } from "@server/lib/aiCapabilities";
import { getUniqueProviderName, getUniqueResourceName } from "@server/db/names";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty()
});

const bodySchema = z
    .strictObject({
        name: z.string().nonempty(),
        type: aiProviderTypeSchema,
        upstreamUrl: z.url().optional().nullable(),
        apiKey: z.string().optional(),
        authType: aiAuthTypeSchema.optional(),
        routingMode: aiRoutingModeSchema.optional(),
        capabilities: aiCapabilitiesSchema.optional(),
        headers: aiProviderHeadersSchema,
        skipTlsVerification: z.boolean().optional(),
        enabled: z.boolean().optional()
    })
    .superRefine((data, ctx) => {
        refineProviderUpstreamFields(data, ctx);
    });

registry.registerPath({
    method: "put",
    path: "/org/{orgId}/ai-provider",
    description: "Create an AI provider for an organization.",
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
        201: {
            description: "Successful response"
        }
    }
});

export async function createAiProvider(
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

        const { orgId } = parsedParams.data;
        const {
            name,
            type,
            upstreamUrl,
            apiKey,
            authType,
            routingMode,
            capabilities,
            headers,
            skipTlsVerification,
            enabled
        } = parsedBody.data;

        const key = config.getRawConfig().server.secret!;
        const encryptedApiKey = apiKey ? encrypt(apiKey, key) : null;
        const apiKeyLastChars = apiKey ? apiKey.slice(-4) : null;
        const now = Date.now();
        const resolved = resolveAiProviderCreateFields({
            type,
            upstreamUrl,
            authType,
            routingMode
        });
        const resolvedCapabilities = resolveCapabilitiesForCreate({
            type,
            capabilities
        });

        if (resolvedCapabilities.length === 0) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "At least one capability is required"
                )
            );
        }

        const niceId = await getUniqueProviderName(orgId);

        const [provider] = await db
            .insert(aiProviders)
            .values({
                orgId,
                name,
                niceId,
                type,
                upstreamUrl: resolved.upstreamUrl,
                apiKey: encryptedApiKey,
                apiKeyLastChars,
                authType: resolved.authType,
                routingMode: resolved.routingMode,
                capabilities: serializeCapabilities(resolvedCapabilities),
                headers: serializeAiProviderHeaders(headers, key),
                skipTlsVerification: skipTlsVerification ?? false,
                enabled: enabled ?? true,
                createdAt: now,
                updatedAt: now
            })
            .returning();

        return response<CreateOrEditAiProviderResponse>(res, {
            data: {
                provider: toPublicAiProvider(provider, { includeApiKey: true })
            },
            success: true,
            error: false,
            message: "AI provider created successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
