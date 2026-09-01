import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, virtualApiKeyResources, virtualApiKeys } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, eq } from "drizzle-orm";
import { toPublicVirtualApiKey } from "@server/lib/virtualApiKey";
import type { GetMyVirtualApiKeyResponse } from "@server/routers/virtualApiKey/types";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty(),
    virtualApiKeyId: z.string().nonempty()
});

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/my-virtual-api-keys/{virtualApiKeyId}",
    description:
        "Get a virtual API key owned by the signed-in user, including the decrypted secret.",
    tags: [OpenAPITags.VirtualApiKey],
    request: {
        params: paramsSchema
    },
    responses: {
        200: {
            description: "Successful response"
        }
    }
});

export async function getMyVirtualApiKey(
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

        const { orgId, virtualApiKeyId } = parsedParams.data;
        const userId = req.user?.userId;

        if (!userId) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
            );
        }

        if (orgId !== req.userOrgId) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not have access to this organization"
                )
            );
        }

        const [key] = await db
            .select()
            .from(virtualApiKeys)
            .where(
                and(
                    eq(virtualApiKeys.virtualApiKeyId, virtualApiKeyId),
                    eq(virtualApiKeys.orgId, orgId),
                    eq(virtualApiKeys.userId, userId)
                )
            )
            .limit(1);

        if (!key) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Virtual API key with ID ${virtualApiKeyId} not found`
                )
            );
        }

        const resourceRows = await db
            .select({ resourceId: virtualApiKeyResources.resourceId })
            .from(virtualApiKeyResources)
            .where(eq(virtualApiKeyResources.virtualApiKeyId, virtualApiKeyId));

        return response<GetMyVirtualApiKeyResponse>(res, {
            data: {
                virtualApiKey: {
                    ...toPublicVirtualApiKey(key, { includeSecret: true }),
                    resourceIds: resourceRows.map((row) => row.resourceId)
                }
            },
            success: true,
            error: false,
            message: "Virtual API key retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
