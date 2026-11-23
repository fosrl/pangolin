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
import { createApiSuccessResponses } from "@server/lib/openapi/createApiResponseSchema";
import { createSelectSchema } from "drizzle-zod";

const adminGetUserSchema = z.strictObject({
    userId: z.string().min(1)
});

const AdminGetUserResponseDataSchema = createSelectSchema(users, {
    userId: (s) => s.openapi({ description: "ID of the user." }),
    email: (s) => s.openapi({ description: "Email of the user." }),
    username: (s) => s.openapi({ description: "Username of the user." }),
    name: (s) => s.openapi({ description: "Display name of the user." }),
    twoFactorEnabled: (s) =>
        s.openapi({
            description:
                "Whether the user has two-factor authentication enabled."
        }),
    twoFactorSetupRequested: (s) =>
        s.openapi({
            description:
                "Whether an admin has asked the user to set up two-factor authentication."
        }),
    emailVerified: (s) =>
        s.openapi({ description: "Whether the user's email is verified." }),
    serverAdmin: (s) =>
        s.openapi({ description: "Whether the user is a server admin." }),
    idpId: (s) =>
        s.openapi({
            description:
                "ID of the identity provider the user belongs to. Null for internal users."
        }),
    dateCreated: (s) =>
        s.openapi({ description: "ISO timestamp when the user was created." })
})
    .pick({
        userId: true,
        email: true,
        username: true,
        name: true,
        type: true,
        twoFactorEnabled: true,
        twoFactorSetupRequested: true,
        emailVerified: true,
        serverAdmin: true,
        idpId: true,
        dateCreated: true
    })
    .extend({
        idpName: z.string().nullable().openapi({
            description:
                "Name of the identity provider the user belongs to. Null for internal users."
        })
    });

registry.registerPath({
    method: "get",
    path: "/user/{userId}",
    description: "Get a user by ID.",
    tags: [OpenAPITags.User],
    request: {
        params: adminGetUserSchema
    },
    responses: createApiSuccessResponses(AdminGetUserResponseDataSchema)
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

export type AdminGetUserResponse = z.infer<
    typeof AdminGetUserResponseDataSchema
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
