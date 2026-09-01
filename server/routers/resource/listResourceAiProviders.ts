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
import { listPublicResourceAiProviders } from "@server/lib/aiInferenceResource";

const listResourceAiProvidersParamsSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive()
});

export type ListResourceAiProvidersResponse = {
    providers: Awaited<ReturnType<typeof listPublicResourceAiProviders>>;
};

registry.registerPath({
    method: "get",
    path: "/resource/{resourceId}/ai-providers",
    description:
        "List AI providers attached to an inference resource, including each attachment's accessMode.",
    tags: [OpenAPITags.PublicResource],
    request: {
        params: listResourceAiProvidersParamsSchema
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

export async function listResourceAiProviders(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = listResourceAiProvidersParamsSchema.safeParse(
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

        const providers = await listPublicResourceAiProviders(resourceId);

        return response<ListResourceAiProvidersResponse>(res, {
            data: { providers },
            success: true,
            error: false,
            message: "Resource AI providers retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
