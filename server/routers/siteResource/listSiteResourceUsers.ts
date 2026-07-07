import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { idp, userSiteResources, users } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";

const listSiteResourceUsersSchema = z
    .object({
        siteResourceId: z
            .string()
            .transform(Number)
            .pipe(z.number().int().positive())
    })
    .strict();

async function queryUsers(siteResourceId: number) {
    return await db
        .select({
            userId: userSiteResources.userId,
            username: users.username,
            type: users.type,
            idpName: idp.name,
            idpId: users.idpId,
            email: users.email
        })
        .from(userSiteResources)
        .innerJoin(users, eq(userSiteResources.userId, users.userId))
        .leftJoin(idp, eq(users.idpId, idp.idpId))
        .where(eq(userSiteResources.siteResourceId, siteResourceId));
}

export type ListSiteResourceUsersResponse = {
    users: NonNullable<Awaited<ReturnType<typeof queryUsers>>>;
};

registry.registerPath({
    method: "get",
    path: "/site-resource/{siteResourceId}/users",
    description: "List all users for a site resource.",
    tags: [OpenAPITags.PrivateResource, OpenAPITags.User],
    request: {
        params: listSiteResourceUsersSchema
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

export async function listSiteResourceUsers(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = listSiteResourceUsersSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { siteResourceId } = parsedParams.data;

        const siteResourceUsersList = await queryUsers(siteResourceId);

        return response<ListSiteResourceUsersResponse>(res, {
            data: {
                users: siteResourceUsersList
            },
            success: true,
            error: false,
            message: "Site resource users retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
