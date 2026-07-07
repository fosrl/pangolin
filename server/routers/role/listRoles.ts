import { db, orgs, roleActions, roles } from "@server/db";
import response from "@server/lib/response";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";
import HttpCode from "@server/types/HttpCode";
import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm";
import { ActionsEnum } from "@server/auth/actions";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { object, z } from "zod";
import { fromError } from "zod-validation-error";
import type { PaginatedResponse } from "@server/types/Pagination";

const listRolesParamsSchema = z.strictObject({
    orgId: z.string()
});

const listRolesSchema = z.strictObject({
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
        .enum(["name"])
        .optional()
        .catch(undefined)
        .openapi({
            type: "string",
            enum: ["name"],
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
        })
});

function queryRolesBase() {
    return db
        .select({
            roleId: roles.roleId,
            orgId: roles.orgId,
            isAdmin: roles.isAdmin,
            name: roles.name,
            description: roles.description,
            orgName: orgs.name,
            requireDeviceApproval: roles.requireDeviceApproval,
            sshSudoMode: roles.sshSudoMode,
            sshSudoCommands: roles.sshSudoCommands,
            sshCreateHomeDir: roles.sshCreateHomeDir,
            sshUnixGroups: roles.sshUnixGroups
        })
        .from(roles)
        .leftJoin(orgs, eq(roles.orgId, orgs.orgId));
    // .where(eq(roles.orgId, orgId))
    // .limit(limit)
    // .offset(offset);
}

export type ListRolesResponse = PaginatedResponse<{
    roles: NonNullable<Awaited<ReturnType<typeof queryRolesBase>>>;
}>;

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/roles",
    description: "List roles.",
    tags: [OpenAPITags.Role],
    request: {
        params: listRolesParamsSchema,
        query: listRolesSchema
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

export async function listRoles(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = listRolesSchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error).toString()
                )
            );
        }

        const { page, pageSize, query, sort_by, order } = parsedQuery.data;

        const parsedParams = listRolesParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { orgId } = parsedParams.data;

        const conditions = [and(eq(roles.orgId, orgId))];

        if (query) {
            conditions.push(
                like(sql`LOWER(${roles.name})`, "%" + query.toLowerCase() + "%")
            );
        }

        const countQuery = db.$count(
            queryRolesBase()
                .where(and(...conditions))
                .as("filtered_roles")
        );

        const rolesListQuery = queryRolesBase()
            .where(and(...conditions))
            .limit(pageSize)
            .offset(pageSize * (page - 1))
            .orderBy(
                sort_by
                    ? order === "asc"
                        ? asc(roles[sort_by])
                        : desc(roles[sort_by])
                    : asc(roles.name)
            );

        const [totalCount, rolesList] = await Promise.all([
            countQuery,
            rolesListQuery
        ]);

        let rolesWithAllowSsh = rolesList;
        if (rolesList.length > 0) {
            const roleIds = rolesList.map((r) => r.roleId);
            const signSshKeyRows = await db
                .select({ roleId: roleActions.roleId })
                .from(roleActions)
                .where(
                    and(
                        inArray(roleActions.roleId, roleIds),
                        eq(roleActions.actionId, ActionsEnum.signSshKey)
                    )
                );
            const roleIdsWithSsh = new Set(signSshKeyRows.map((r) => r.roleId));
            rolesWithAllowSsh = rolesList.map((r) => ({
                ...r,
                allowSsh: roleIdsWithSsh.has(r.roleId)
            }));
        }

        return response(res, {
            data: {
                roles: rolesWithAllowSsh,
                pagination: {
                    total: totalCount,
                    page,
                    pageSize
                }
            },
            success: true,
            error: false,
            message: "Roles retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
