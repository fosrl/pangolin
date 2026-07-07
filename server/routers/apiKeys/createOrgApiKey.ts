import { NextFunction, Request, Response } from "express";
import { db } from "@server/db";
import HttpCode from "@server/types/HttpCode";
import { z } from "zod";
import { createApiResponseSchema } from "@server/lib/openapi/createApiResponseSchema";
import { apiKeyOrg, apiKeys } from "@server/db";
import { fromError } from "zod-validation-error";
import createHttpError from "http-errors";
import response from "@server/lib/response";
import moment from "moment";
import {
    generateId,
    generateIdFromEntropySize
} from "@server/auth/sessions/app";
import logger from "@server/logger";
import { hashPassword } from "@server/auth/password";
import { OpenAPITags, registry } from "@server/openApi";

const paramsSchema = z.object({
    orgId: z.string().nonempty()
});

const bodySchema = z.object({
    name: z.string().min(1).max(255)
});

export type CreateOrgApiKeyBody = z.infer<typeof bodySchema>;

export type CreateOrgApiKeyResponse = {
    apiKeyId: string;
    name: string;
    apiKey: string;
    lastChars: string;
    createdAt: string;
};
const CreateOrgApiKeyResponseDataSchema = z.object({
    apiKeyId: z.string(),
    name: z.string(),
    apiKey: z.string(),
    lastChars: z.string(),
    createdAt: z.string()
});


registry.registerPath({
    method: "put",
    path: "/org/{orgId}/api-key",
    description: "Create a new API key scoped to the organization.",
    tags: [OpenAPITags.ApiKey],
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
            description: "Successful response",
            content: {
                "application/json": {
                    schema: createApiResponseSchema(CreateOrgApiKeyResponseDataSchema)
                }
            }
        }
    }
});

export async function createOrgApiKey(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
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
    const { name } = parsedBody.data;

    const apiKeyId = generateId(15);
    const apiKey = generateIdFromEntropySize(25);
    const apiKeyHash = await hashPassword(apiKey);
    const lastChars = apiKey.slice(-4);
    const createdAt = moment().toISOString();

    await db.transaction(async (trx) => {
        await trx.insert(apiKeys).values({
            name,
            apiKeyId,
            apiKeyHash,
            createdAt,
            lastChars
        });

        await trx.insert(apiKeyOrg).values({
            apiKeyId,
            orgId
        });
    });

    try {
        return response<CreateOrgApiKeyResponse>(res, {
            data: {
                apiKeyId,
                apiKey,
                name,
                lastChars,
                createdAt
            },
            success: true,
            error: false,
            message: "API key created",
            status: HttpCode.CREATED
        });
    } catch (e) {
        logger.error(e);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to create API key"
            )
        );
    }
}
