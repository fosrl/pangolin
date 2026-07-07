import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { userOrgs, users } from "@server/db";
import { and, eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { queryUser, type GetOrgUserResponse } from "./getOrgUser";

const getOrgUserByUsernameParamsSchema = z.strictObject({
    orgId: z.string()
});

const getOrgUserByUsernameQuerySchema = z.strictObject({
    username: z.string().min(1, "username is required"),
    idpId: z
        .string()
        .optional()
        .transform((v) =>
            v === undefined || v === "" ? undefined : parseInt(v, 10)
        )
        .refine(
            (v) =>
                v === undefined || (Number.isInteger(v) && (v as number) > 0),
            { message: "idpId must be a positive integer" }
        )
});

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/user-by-username",
    description:
        "Get a user in an organization by username. When idpId is not passed, only internal users are searched (username is globally unique for them). For external (OIDC) users, pass idpId to search by username within that identity provider.",
    tags: [OpenAPITags.User],
    request: {
        params: getOrgUserByUsernameParamsSchema,
        query: getOrgUserByUsernameQuerySchema
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

export async function getOrgUserByUsername(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = getOrgUserByUsernameParamsSchema.safeParse(
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

        const parsedQuery = getOrgUserByUsernameQuerySchema.safeParse(
            req.query
        );
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error).toString()
                )
            );
        }

        const { orgId } = parsedParams.data;
        const { username, idpId } = parsedQuery.data;

        const conditions = [
            eq(userOrgs.orgId, orgId),
            eq(users.username, username)
        ];
        if (idpId !== undefined) {
            conditions.push(eq(users.idpId, idpId));
        } else {
            conditions.push(eq(users.type, "internal"));
        }

        const candidates = await db
            .select({ userId: users.userId })
            .from(userOrgs)
            .innerJoin(users, eq(userOrgs.userId, users.userId))
            .where(and(...conditions));

        if (candidates.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `User with username '${username}' not found in organization`
                )
            );
        }

        if (candidates.length > 1) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Multiple users with this username (external users from different identity providers). Specify idpId (identity provider ID) to disambiguate. When not specified, this searches for internal users only."
                )
            );
        }

        const user = await queryUser(orgId, candidates[0].userId);
        if (!user) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `User with username '${username}' not found in organization`
                )
            );
        }

        return response<GetOrgUserResponse>(res, {
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
