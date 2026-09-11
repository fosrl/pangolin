import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, users } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { createApiResponseSchema } from "@server/lib/openapi/createApiResponseSchema";

const setServerAdminParamsSchema = z.strictObject({
    userId: z.string()
});

const setServerAdminBodySchema = z.strictObject({
    serverAdmin: z.boolean()
});

export type AdminSetServerAdminResponse = {
    userId: string;
    serverAdmin: boolean;
};

const AdminSetServerAdminResponseDataSchema = z.object({
    userId: z.string(),
    serverAdmin: z.boolean()
});

registry.registerPath({
    method: "post",
    path: "/user/{userId}/server-admin",
    description: "Promote or demote a user's server admin status (server admin).",
    tags: [OpenAPITags.User],
    request: {
        params: setServerAdminParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: setServerAdminBodySchema
                }
            }
        }
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: createApiResponseSchema(
                        AdminSetServerAdminResponseDataSchema
                    )
                }
            }
        }
    }
});

export async function adminSetServerAdmin(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = setServerAdminParamsSchema.safeParse(
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

        const parsedBody = setServerAdminBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { userId } = parsedParams.data;
        const { serverAdmin } = parsedBody.data;

        const [existingUser] = await db
            .select({
                userId: users.userId,
                serverAdmin: users.serverAdmin
            })
            .from(users)
            .where(eq(users.userId, userId))
            .limit(1);

        if (!existingUser) {
            return next(createHttpError(HttpCode.NOT_FOUND, "User not found"));
        }

        if (!serverAdmin && req.user?.userId === userId) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "You cannot remove your own server admin status"
                )
            );
        }

        if (existingUser.serverAdmin !== serverAdmin) {
            logger.info(
                `${serverAdmin ? "Promoting" : "Demoting"} user ${userId} ${serverAdmin ? "to" : "from"} server admin (by ${req.user?.userId})`
            );

            await db
                .update(users)
                .set({ serverAdmin })
                .where(eq(users.userId, userId));
        }

        return response<AdminSetServerAdminResponse>(res, {
            data: {
                userId: existingUser.userId,
                serverAdmin
            },
            success: true,
            error: false,
            message: serverAdmin
                ? "User promoted to server admin successfully"
                : "User demoted from server admin successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
