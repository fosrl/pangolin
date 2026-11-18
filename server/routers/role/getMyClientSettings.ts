import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import type { ClientSettings } from "@server/lib/clientSettings";
import { getClientSettingsForUser } from "#dynamic/lib/clientSettings";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty()
});

export type GetMyClientSettingsResponse = {
    settings: ClientSettings | null;
};

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/my-client-settings",
    description:
        "Get the client settings the organization applies to the current user's devices.",
    tags: [OpenAPITags.Role],
    request: {
        params: paramsSchema
    },
    responses: {
        200: { description: "Successful response" }
    }
});

export async function getMyClientSettings(
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

        const { orgId } = parsedParams.data;
        const userId = req.user?.userId;
        if (!userId) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
            );
        }

        const settings = await getClientSettingsForUser(orgId, userId);

        return response<GetMyClientSettingsResponse>(res, {
            data: { settings: settings ?? null },
            success: true,
            error: false,
            message: "Client settings retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
