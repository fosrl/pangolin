import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, users } from "@server/db";
import { orgs, resources, sites, userOrgs } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { and, asc, desc, eq, like, or, sql, type SQL } from "drizzle-orm";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { createApiResponseSchema } from "@server/lib/openapi/createApiResponseSchema";
import type { PaginatedResponse } from "@server/types/Pagination";

const adminListOrgsSchema = z.strictObject({
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
        .positive()
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
        .enum(["name", "createdAt"])
        .optional()
        .catch(undefined)
        .openapi({
            type: "string",
            enum: ["name", "createdAt"],
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

export type AdminOrgRow = {
    orgId: string;
    name: string;
    subnet: string | null;
    utilitySubnet: string | null;
    createdAt: string | null;
    userCount: number;
    siteCount: number;
    resourceCount: number;
    owner: {
        userId: string;
        username: string;
    } | null;
};

export type AdminListOrgsResponse = PaginatedResponse<{
    orgs: AdminOrgRow[];
}>;

const AdminListOrgsResponseDataSchema = z.object({
    orgs: z.array(
        z.object({
            orgId: z.string(),
            name: z.string(),
            subnet: z.string().nullable(),
            createdAt: z.string().nullable(),
            userCount: z.number(),
            siteCount: z.number(),
            resourceCount: z.number()
        })
    ),
    pagination: z.object({
        total: z.number(),
        page: z.number(),
        pageSize: z.number()
    })
});

registry.registerPath({
    method: "get",
    path: "/admin/orgs",
    description:
        "List all organizations in the system with usage counts (server admin).",
    tags: [OpenAPITags.Org],
    request: {
        query: adminListOrgsSchema
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: createApiResponseSchema(
                        AdminListOrgsResponseDataSchema
                    )
                }
            }
        }
    }
});

export async function adminListOrgs(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = adminListOrgsSchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error)
                )
            );
        }

        const { pageSize, page, query, sort_by, order } = parsedQuery.data;

        let conditions: (SQL<unknown> | undefined)[] = [];
        if (query) {
            const q = "%" + query.toLowerCase() + "%";
            conditions.push(
                or(
                    like(sql`LOWER(${orgs.name})`, q),
                    like(sql`LOWER(${orgs.orgId})`, q),
                    like(sql`LOWER(${orgs.subnet})`, q)
                )
            );
        }

        const sortColumns = {
            name: orgs.name,
            createdAt: orgs.createdAt
        } as const;

        const orderBy = sort_by
            ? order === "asc"
                ? asc(sortColumns[sort_by])
                : desc(sortColumns[sort_by])
            : asc(orgs.name);

        // Drizzle renders bare column references in the select list without their
        // table prefix, which would make a correlated subquery compare a column to
        // itself, so the outer `orgs` side is qualified explicitly.
        const orgIdRef = sql`${sql.identifier("orgs")}.${sql.identifier("orgId")}`;

        const [countRows, rows] = await Promise.all([
            db
                .select({ count: sql<number>`count(*)` })
                .from(orgs)
                .where(and(...conditions)),
            db
                .selectDistinct({
                    orgId: orgs.orgId,
                    name: orgs.name,
                    subnet: orgs.subnet,
                    utilitySubnet: orgs.utilitySubnet,
                    createdAt: orgs.createdAt,
                    userCount: sql<number>`(
                        SELECT COUNT(*)
                        FROM ${userOrgs}
                        WHERE ${userOrgs.orgId} = ${orgIdRef}
                    )`.as("userCount"),
                    siteCount: sql<number>`(
                        SELECT COUNT(*)
                        FROM ${sites}
                        WHERE ${sites.orgId} = ${orgIdRef}
                    )`.as("siteCount"),
                    resourceCount: sql<number>`(
                        SELECT COUNT(*)
                        FROM ${resources}
                        WHERE ${resources.orgId} = ${orgIdRef}
                    )`.as("resourceCount"),
                    owner: {
                        userId: users.userId,
                        username: users.username
                    }
                })
                .from(orgs)
                .where(and(...conditions, eq(userOrgs.isOwner, true)))
                .leftJoin(userOrgs, eq(userOrgs.orgId, orgs.orgId))
                .leftJoin(users, eq(userOrgs.userId, users.userId))
                .limit(pageSize)
                .offset(pageSize * (page - 1))
                .orderBy(orderBy)
        ]);

        const totalCount = Number(countRows[0]?.count ?? 0);

        return response<AdminListOrgsResponse>(res, {
            data: {
                orgs: rows.map((row) => ({
                    ...row,
                    userCount: Number(row.userCount ?? 0),
                    siteCount: Number(row.siteCount ?? 0),
                    resourceCount: Number(row.resourceCount ?? 0)
                })),
                pagination: {
                    total: totalCount,
                    page,
                    pageSize
                }
            },
            success: true,
            error: false,
            message: "Organizations retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "An error occurred..."
            )
        );
    }
}
