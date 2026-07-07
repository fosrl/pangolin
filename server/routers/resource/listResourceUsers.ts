import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { idp, userResources, users } from "@server/db"; // Assuming these are the correct tables
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";

const listResourceUsersSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive()
});

async function queryUsers(resourceId: number) {
    return await db
        .select({
            userId: userResources.userId,
            username: users.username,
            type: users.type,
            idpName: idp.name,
            idpId: users.idpId,
            email: users.email
        })
        .from(userResources)
        .innerJoin(users, eq(userResources.userId, users.userId))
        .leftJoin(idp, eq(users.idpId, idp.idpId))
        .where(eq(userResources.resourceId, resourceId));
}

export type ListResourceUsersResponse = {
    users: NonNullable<Awaited<ReturnType<typeof queryUsers>>>;
};

registry.registerPath({
    method: "get",
    path: "/resource/{resourceId}/users",
    description: "List all users for a resource.",
    tags: [OpenAPITags.PublicResource, OpenAPITags.User],
    request: {
        params: listResourceUsersSchema
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

export async function listResourceUsers(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = listResourceUsersSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { resourceId } = parsedParams.data;

        const resourceUsersList = await queryUsers(resourceId);

        return response<ListResourceUsersResponse>(res, {
            data: {
                users: resourceUsersList
            },
            success: true,
            error: false,
            message: "Resource users retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
