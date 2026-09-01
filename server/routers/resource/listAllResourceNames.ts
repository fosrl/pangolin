import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { resources } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { eq } from "drizzle-orm";
import logger from "@server/logger";
import { fromZodError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";

const listResourcesParamsSchema = z.strictObject({
    orgId: z.string()
});

function queryResourceNames(orgId: string) {
    return db
        .select({
            resourceId: resources.resourceId,
            name: resources.name
        })
        .from(resources)

        .where(eq(resources.orgId, orgId));
}

export type ListResourceNamesResponse = Awaited<
    ReturnType<typeof queryResourceNames>
>;

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/resources-names",
    description: "List all resource names for an organization.",
    tags: [OpenAPITags.PublicResourceLegacy],
    request: {
        params: z.object({
            orgId: z.string()
        })
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
    method: "get",
    path: "/org/{orgId}/public-resource-names",
    description: "List all resource names for an organization.",
    tags: [OpenAPITags.PublicResource],
    request: {
        params: z.object({
            orgId: z.string()
        })
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

export async function listAllResourceNames(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = listResourcesParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsedParams.error)
                )
            );
        }

        const orgId = parsedParams.data.orgId;

        const data = await queryResourceNames(orgId);

        return response<ListResourceNamesResponse>(res, {
            data,
            success: true,
            error: false,
            message: "Resource Names retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
