import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import {
    resourceWhitelist,
    resourcePolicyWhiteList,
    resources
} from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";

const getResourceWhitelistSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive()
});

async function queryWhitelist(resourceId: number) {
    return await db
        .select({
            email: resourceWhitelist.email
        })
        .from(resourceWhitelist)
        .where(eq(resourceWhitelist.resourceId, resourceId));
}

async function queryPolicyWhitelist(policyId: number) {
    return await db
        .select({
            email: resourcePolicyWhiteList.email
        })
        .from(resourcePolicyWhiteList)
        .where(eq(resourcePolicyWhiteList.resourcePolicyId, policyId));
}

export type GetResourceWhitelistResponse = {
    whitelist: NonNullable<Awaited<ReturnType<typeof queryWhitelist>>>;
};

registry.registerPath({
    method: "get",
    path: "/resource/{resourceId}/whitelist",
    description: "Get the whitelist of emails for a specific resource.",
    tags: [OpenAPITags.PublicResource],
    request: {
        params: getResourceWhitelistSchema
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

export async function getResourceWhitelist(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = getResourceWhitelistSchema.safeParse(req.params);
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

        const isInlinePolicy =
            resource.resourcePolicyId === null &&
            resource.defaultResourcePolicyId !== null;

        const whitelist = isInlinePolicy
            ? await queryPolicyWhitelist(resource.defaultResourcePolicyId!)
            : await queryWhitelist(resourceId);

        return response<GetResourceWhitelistResponse>(res, {
            data: {
                whitelist
            },
            success: true,
            error: false,
            message: "Resource whitelist retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
