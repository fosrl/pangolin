import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { idp, users } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";

const adminGetUserSchema = z.strictObject({
    userId: z.string().min(1)
});

registry.registerPath({
    method: "get",
    path: "/user/{userId}",
    description: "Get a user by ID.",
    tags: [OpenAPITags.User],
    request: {
        params: adminGetUserSchema
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

async function queryUser(userId: string) {
    const [user] = await db
        .select({
            userId: users.userId,
            email: users.email,
            username: users.username,
            name: users.name,
            type: users.type,
            twoFactorEnabled: users.twoFactorEnabled,
            twoFactorSetupRequested: users.twoFactorSetupRequested,
            emailVerified: users.emailVerified,
            serverAdmin: users.serverAdmin,
            idpName: idp.name,
            idpId: users.idpId,
            dateCreated: users.dateCreated
        })
        .from(users)
        .leftJoin(idp, eq(users.idpId, idp.idpId))
        .where(eq(users.userId, userId))
        .limit(1);
    return user;
}

export type AdminGetUserResponse = NonNullable<
    Awaited<ReturnType<typeof queryUser>>
>;

export async function adminGetUser(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = adminGetUserSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid user ID")
            );
        }
        const { userId } = parsedParams.data;

        const user = await queryUser(userId);

        if (!user) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `User with ID ${userId} not found`
                )
            );
        }

        return response<AdminGetUserResponse>(res, {
            data: user,
            success: true,
            error: false,
            message: "User retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
