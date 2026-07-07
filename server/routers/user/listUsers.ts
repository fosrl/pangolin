import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, idpOidcConfig } from "@server/db";
import { idp, idpOrg, roles, userOrgRoles, userOrgs, users } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import {
    and,
    asc,
    desc,
    eq,
    exists,
    inArray,
    like,
    or,
    sql
} from "drizzle-orm";
import logger from "@server/logger";
import { fromZodError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import type { PaginatedResponse } from "@server/types/Pagination";
import { UserType } from "@server/types/UserTypes";

const listUsersParamsSchema = z.strictObject({
    orgId: z.string()
});

const listUsersSchema = z.strictObject({
    pageSize: z.coerce
        .number<string>() // for prettier formatting
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
        .number<string>() // for prettier formatting
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
        .enum(["username"])
        .optional()
        .catch(undefined)
        .openapi({
            type: "string",
            enum: ["username"],
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
    role_id: z
        .preprocess((val) => {
            if (val === undefined || val === null || val === "") {
                return undefined;
            }
            const raw = Array.isArray(val) ? val : [val];
            const nums = raw
                .map((v) =>
                    typeof v === "string" ? parseInt(v, 10) : Number(v)
                )
                .filter((n) => Number.isInteger(n) && n > 0);
            const unique = [...new Set(nums)];
            return unique.length ? unique : undefined;
        }, z.array(z.number().int().positive()).max(50).optional())
        .openapi({
            description:
                "Filter users who have any of these role ids in the organization (repeat query param)"
        })
});

function queryUsersBase() {
    return db
        .select({
            id: users.userId,
            email: users.email,
            emailVerified: users.emailVerified,
            dateCreated: users.dateCreated,
            orgId: userOrgs.orgId,
            username: users.username,
            name: users.name,
            type: users.type,
            isOwner: userOrgs.isOwner,
            idpName: idp.name,
            idpId: users.idpId,
            idpType: idp.type,
            idpVariant: idpOidcConfig.variant,
            twoFactorEnabled: users.twoFactorEnabled
        })
        .from(users)
        .leftJoin(userOrgs, eq(users.userId, userOrgs.userId))
        .leftJoin(idp, eq(users.idpId, idp.idpId))
        .leftJoin(idpOidcConfig, eq(idpOidcConfig.idpId, idp.idpId));
}

export type ListUsersResponse = PaginatedResponse<{
    users: Array<
        NonNullable<Awaited<ReturnType<typeof queryUsersBase>>>[number] & {
            roles: Array<{
                roleId: number;
                roleName: string;
            }>;
        }
    >;
}>;

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/users",
    description: "List users in an organization.",
    tags: [OpenAPITags.User],
    request: {
        params: listUsersParamsSchema,
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

export async function listUsers(
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
        const { page, pageSize, sort_by, order, query, idp_id, role_id } =
            parsedQuery.data;
        const roleIds = role_id ?? [];

        const parsedParams = listUsersParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsedParams.error)
                )
            );
        }

        const { orgId } = parsedParams.data;

        if (typeof idp_id === "number") {
            const idpOk = await db
                .select({ one: sql`1` })
                .from(idpOrg)
                .where(and(eq(idpOrg.orgId, orgId), eq(idpOrg.idpId, idp_id)))
                .limit(1);
            if (idpOk.length === 0) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "idp_id is not linked to this organization"
                    )
                );
            }
        }

        if (roleIds.length > 0) {
            const validRoles = await db
                .select({ roleId: roles.roleId })
                .from(roles)
                .where(
                    and(eq(roles.orgId, orgId), inArray(roles.roleId, roleIds))
                );
            if (validRoles.length !== roleIds.length) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "One or more role_id values are not valid for this organization"
                    )
                );
            }
        }

        const conditions = [and(eq(userOrgs.orgId, orgId))];

        if (query) {
            conditions.push(
                or(
                    like(
                        sql`LOWER(${users.name})`,
                        "%" + query.toLowerCase() + "%"
                    ),
                    like(
                        sql`LOWER(${users.username})`,
                        "%" + query.toLowerCase() + "%"
                    ),
                    like(
                        sql`LOWER(${users.email})`,
                        "%" + query.toLowerCase() + "%"
                    )
                )
            );
        }

        if (idp_id === "internal") {
            conditions.push(eq(users.type, UserType.Internal));
        } else if (typeof idp_id === "number") {
            conditions.push(eq(users.idpId, idp_id));
        }

        if (roleIds.length > 0) {
            conditions.push(
                exists(
                    db
                        .select()
                        .from(userOrgRoles)
                        .where(
                            and(
                                eq(userOrgRoles.userId, users.userId),
                                eq(userOrgRoles.orgId, orgId),
                                inArray(userOrgRoles.roleId, roleIds)
                            )
                        )
                )
            );
        }

        const countQuery = db.$count(
            queryUsersBase()
                .where(and(...conditions))
                .as("filtered_users")
        );

        const userListQuery = queryUsersBase()
            .where(and(...conditions))
            .limit(pageSize)
            .offset(pageSize * (page - 1))
            .orderBy(
                sort_by
                    ? order === "asc"
                        ? asc(users[sort_by])
                        : desc(users[sort_by])
                    : asc(users.name)
            );

        const [total, usersWithoutRoles] = await Promise.all([
            countQuery,
            userListQuery
        ]);

        const userIds = usersWithoutRoles.map((r) => r.id);
        const roleRows =
            userIds.length === 0
                ? []
                : await db
                      .select({
                          userId: userOrgRoles.userId,
                          roleId: userOrgRoles.roleId,
                          roleName: roles.name
                      })
                      .from(userOrgRoles)
                      .leftJoin(roles, eq(userOrgRoles.roleId, roles.roleId))
                      .where(
                          and(
                              eq(userOrgRoles.orgId, orgId),
                              inArray(userOrgRoles.userId, userIds)
                          )
                      );

        const rolesByUser = new Map<
            string,
            { roleId: number; roleName: string }[]
        >();
        for (const r of roleRows) {
            const list = rolesByUser.get(r.userId) ?? [];
            list.push({ roleId: r.roleId, roleName: r.roleName ?? "" });
            rolesByUser.set(r.userId, list);
        }

        const usersWithRoles: ListUsersResponse["users"] = [];

        for (const user of usersWithoutRoles) {
            const userRoles = rolesByUser.get(user.id) ?? [];
            usersWithRoles.push({
                ...user,
                roles: userRoles
            });
        }

        return response<ListUsersResponse>(res, {
            data: {
                users: usersWithRoles,
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
