import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, idp, users } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import logger from "@server/logger";
import { fromZodError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import type { PaginatedResponse } from "@server/types/Pagination";
import { UserType } from "@server/types/UserTypes";

const listUsersSchema = z.strictObject({
    pageSize: z.coerce
        .number<string>()
        .int()
        .positive()
        .optional()
        .catch(20)
        .default(20)
        .openapi({
            type: "integer",
            default: 20,
            description: "Number of items per page"
        }),
    page: z.coerce
        .number<string>()
        .int()
        .min(0)
        .optional()
        .catch(1)
        .default(1)
        .openapi({
            type: "integer",
            default: 1,
            description: "Page number to retrieve"
        }),
    query: z.string().optional(),
    sort_by: z
        .enum(["username", "email", "name"])
        .optional()
        .catch(undefined)
        .openapi({
            type: "string",
            enum: ["username", "email", "name"],
            description: "Field to sort by"
        }),
    order: z
        .enum(["asc", "desc"])
        .optional()
        .default("asc")
        .catch("asc")
        .openapi({
            type: "string",
            enum: ["asc", "desc"],
            default: "asc",
            description: "Sort order"
        }),
    idp_id: z
        .preprocess(
            (val) => {
                if (val === undefined || val === null || val === "") {
                    return undefined;
                }
                if (val === "internal") {
                    return "internal";
                }
                if (typeof val === "string" && /^\d+$/.test(val)) {
                    return parseInt(val, 10);
                }
                return undefined;
            },
            z
                .union([z.literal("internal"), z.number().int().positive()])
                .optional()
        )
        .openapi({
            description:
                'Filter by identity provider id, or "internal" for internal users'
        }),
    two_factor: z
        .enum(["true", "false"])
        .transform((v) => v === "true")
        .optional()
        .catch(undefined)
        .openapi({
            type: "boolean",
            description:
                "Filter by 2FA state matching: enabled if twoFactorEnabled or twoFactorSetupRequested"
        })
});

function queryUsersBase() {
    return db
        .select({
            id: users.userId,
            email: users.email,
            username: users.username,
            name: users.name,
            dateCreated: users.dateCreated,
            serverAdmin: users.serverAdmin,
            type: users.type,
            idpName: idp.name,
            idpId: users.idpId,
            twoFactorEnabled: users.twoFactorEnabled,
            twoFactorSetupRequested: users.twoFactorSetupRequested
        })
        .from(users)
        .leftJoin(idp, eq(users.idpId, idp.idpId));
}

/** Row shape returned by `queryUsersBase()` (matches selected columns + join). */
export type AdminListUserRow = {
    id: string;
    email: string | null;
    username: string;
    name: string | null;
    dateCreated: string;
    serverAdmin: boolean;
    type: string;
    idpName: string | null;
    idpId: number | null;
    twoFactorEnabled: boolean;
    twoFactorSetupRequested: boolean | null;
};

export type AdminListUsersResponse = PaginatedResponse<{
    users: AdminListUserRow[];
}>;

registry.registerPath({
    method: "get",
    path: "/users",
    description: "List non–server-admin users (server admin).",
    tags: [OpenAPITags.User],
    request: {
        query: listUsersSchema
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

export async function adminListUsers(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = listUsersSchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsedQuery.error)
                )
            );
        }
        const {
            page,
            pageSize,
            query,
            sort_by,
            order,
            idp_id,
            two_factor: twoFactorFilter
        } = parsedQuery.data;

        if (typeof idp_id === "number") {
            const idpOk = await db
                .select({ one: sql`1` })
                .from(idp)
                .where(eq(idp.idpId, idp_id))
                .limit(1);
            if (idpOk.length === 0) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "idp_id does not exist"
                    )
                );
            }
        }

        const conditions = [eq(users.serverAdmin, false)];

        if (query) {
            const q = "%" + query.toLowerCase() + "%";
            conditions.push(
                or(
                    like(sql`LOWER(${users.username})`, q),
                    like(sql`LOWER(${users.email})`, q),
                    like(sql`LOWER(${users.name})`, q)
                )!
            );
        }

        if (idp_id === "internal") {
            conditions.push(eq(users.type, UserType.Internal));
        } else if (typeof idp_id === "number") {
            conditions.push(eq(users.idpId, idp_id));
        }

        if (typeof twoFactorFilter === "boolean") {
            if (twoFactorFilter) {
                conditions.push(
                    or(
                        eq(users.twoFactorEnabled, true),
                        eq(users.twoFactorSetupRequested, true)
                    )!
                );
            } else {
                conditions.push(
                    and(
                        eq(users.twoFactorEnabled, false),
                        eq(users.twoFactorSetupRequested, false)
                    )!
                );
            }
        }

        const whereClause = and(...conditions);

        const countQuery = db.$count(
            queryUsersBase().where(whereClause).as("filtered_admin_users")
        );

        const userListQuery = queryUsersBase()
            .where(whereClause)
            .limit(pageSize)
            .offset(pageSize * (page - 1))
            .orderBy(
                sort_by
                    ? order === "asc"
                        ? asc(users[sort_by])
                        : desc(users[sort_by])
                    : asc(users.username)
            );

        const [total, rows] = await Promise.all([countQuery, userListQuery]);

        return response<AdminListUsersResponse>(res, {
            data: {
                users: rows,
                pagination: {
                    total,
                    page,
                    pageSize
                }
            },
            success: true,
            error: false,
            message: "Users retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
