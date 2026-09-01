import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { aiProviders, db } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { eq } from "drizzle-orm";

const paramsSchema = z.strictObject({
    providerId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "delete",
    path: "/ai-provider/{providerId}",
    description: "Delete an AI provider.",
    tags: [OpenAPITags.AiProvider],
    request: {
        params: paramsSchema
    },
    responses: {
        200: {
            description: "Successful response"
        }
    }
});

export async function deleteAiProvider(
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

        const { providerId } = parsedParams.data;

        const [existing] = await db
            .select({ providerId: aiProviders.providerId })
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

        await db
            .delete(aiProviders)
            .where(eq(aiProviders.providerId, providerId));

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "AI provider deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
