import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { aiProviders, db } from "@server/db";
import response from "@server/lib/response";
import stoi from "@server/lib/stoi";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, eq } from "drizzle-orm";
import type { GetAiProviderResponse } from "@server/routers/aiProvider/types";
import { toPublicAiProvider } from "@server/routers/aiProvider/types";

const paramsSchema = z.strictObject({
    providerId: z
        .string()
        .optional()
        .transform(stoi)
        .pipe(z.int().positive().optional())
        .optional(),
    niceId: z.string().optional(),
    orgId: z.string().optional()
});

async function query(providerId?: number, niceId?: string, orgId?: string) {
    if (providerId) {
        const [res] = await db
            .select()
            .from(aiProviders)
            .where(eq(aiProviders.providerId, providerId))
            .limit(1);
        return res;
    } else if (niceId && orgId) {
        const [res] = await db
            .select()
            .from(aiProviders)
            .where(
                and(
                    eq(aiProviders.niceId, niceId),
                    eq(aiProviders.orgId, orgId)
                )
            )
            .limit(1);
        return res;
    }
}

registry.registerPath({
    method: "get",
    path: "/ai-provider/{providerId}",
    description: "Get an AI provider by ID.",
    tags: [OpenAPITags.AiProvider],
    request: {
        params: z.object({
            providerId: z.string()
        })
    },
    responses: {
        200: {
            description: "Successful response"
        }
    }
});

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/ai-provider/{niceId}",
    description:
        "Get an AI provider by orgId and niceId. NiceId is a readable ID for the provider and unique on a per org basis.",
    tags: [OpenAPITags.AiProvider],
    request: {
        params: z.object({
            orgId: z.string(),
            niceId: z.string()
        })
    },
    responses: {
        200: {
            description: "Successful response"
        }
    }
});

export async function getAiProvider(
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

        const { providerId, niceId, orgId } = parsedParams.data;

        const provider =
            req.aiProvider &&
            (req.aiProvider.providerId === providerId ||
                (niceId &&
                    req.aiProvider.niceId === niceId &&
                    req.aiProvider.orgId === orgId))
                ? req.aiProvider
                : await query(providerId, niceId, orgId);

        if (!provider) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `AI provider with ID ${providerId || niceId} not found`
                )
            );
        }

        return response<GetAiProviderResponse>(res, {
            data: {
                provider: toPublicAiProvider(provider, { includeApiKey: true })
            },
            success: true,
            error: false,
            message: "AI provider retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
