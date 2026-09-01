import { db } from "@server/db";
import response from "@server/lib/response";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";
import HttpCode from "@server/types/HttpCode";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import {
    performDeleteResource,
    runResourceDeleteSideEffects
} from "@server/lib/deleteResource";
import { LimitId } from "@server/lib/billing";
import { usageService } from "@server/lib/billing/usageService";

const deleteResourceSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "delete",
    path: "/resource/{resourceId}",
    description: "Delete a resource.",
    tags: [OpenAPITags.PublicResourceLegacy],
    request: {
        params: deleteResourceSchema
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

registry.registerPath({
    method: "delete",
    path: "/public-resource/{resourceId}",
    description: "Delete a resource.",
    tags: [OpenAPITags.PublicResource],
    request: {
        params: deleteResourceSchema
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

export async function deleteResource(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = deleteResourceSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { resourceId } = parsedParams.data;

        let deleteResult = null;

        await db.transaction(async (trx) => {
            deleteResult = await performDeleteResource(resourceId, trx);
            if (deleteResult?.deletedResource?.orgId) {
                await usageService.add(
                    deleteResult?.deletedResource?.orgId,
                    LimitId.PUBLIC_RESOURCES,
                    -1,
                    trx
                );
            }
        });

        if (!deleteResult) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource with ID ${resourceId} not found`
                )
            );
        }

        await runResourceDeleteSideEffects(deleteResult);

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Resource deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        if (createHttpError.isHttpError(error)) {
            return next(error);
        }
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
