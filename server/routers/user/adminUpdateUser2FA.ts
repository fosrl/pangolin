import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { createApiResponseSchema } from "@server/lib/openapi/createApiResponseSchema";
import { db } from "@server/db";
import { users, userOrgs } from "@server/db";
import { eq, and } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";

const updateUser2FAParamsSchema = z.strictObject({
    userId: z.string()
});

const updateUser2FABodySchema = z.strictObject({
    twoFactorSetupRequested: z.boolean()
});

export type UpdateUser2FAResponse = {
    userId: string;
    twoFactorRequested: boolean;
};
const UpdateUser2FAResponseDataSchema = z.object({
    userId: z.string(),
    twoFactorRequested: z.boolean()
});


registry.registerPath({
    method: "post",
    path: "/user/{userId}/2fa",
    description: "Update a user's 2FA status.",
    tags: [OpenAPITags.User],
    request: {
        params: updateUser2FAParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: updateUser2FABodySchema
                }
            }
        }
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: createApiResponseSchema(UpdateUser2FAResponseDataSchema)
                }
            }
        }
    }
});

export async function updateUser2FA(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = updateUser2FAParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const parsedBody = updateUser2FABodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { userId } = parsedParams.data;
        const { twoFactorSetupRequested } = parsedBody.data;

        // Verify the user exists in the organization
        const existingUser = await db
            .select()
            .from(users)
            .where(eq(users.userId, userId))
            .limit(1);

        if (existingUser.length === 0) {
            return next(createHttpError(HttpCode.NOT_FOUND, "User not found"));
        }

        if (existingUser[0].type !== "internal") {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Two-factor authentication is not supported for external users"
                )
            );
        }

        logger.debug(
            `Updating 2FA for user ${userId} to ${twoFactorSetupRequested}`
        );

        if (twoFactorSetupRequested) {
            await db
                .update(users)
                .set({
                    twoFactorSetupRequested: true
                })
                .where(eq(users.userId, userId));
        } else {
            await db
                .update(users)
                .set({
                    twoFactorSetupRequested: false,
                    twoFactorEnabled: false,
                    twoFactorSecret: null
                })
                .where(eq(users.userId, userId));
        }

        return response<UpdateUser2FAResponse>(res, {
            data: {
                userId: existingUser[0].userId,
                twoFactorRequested: twoFactorSetupRequested
            },
            success: true,
            error: false,
            message: `2FA ${twoFactorSetupRequested ? "enabled" : "disabled"} for user successfully`,
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
