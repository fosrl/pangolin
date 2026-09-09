import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { redirects, db } from "@server/db";
import type { Redirect } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, asc, eq, like, sql } from "drizzle-orm";
import type { PaginatedResponse } from "@server/types/Pagination";

export type ListRedirectsResponse = PaginatedResponse<{
    redirects: Redirect[];
}>;

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty()
});

const listSchema = z.object({
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
    query: z.string().optional()
});

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/redirects",
    description: "List redirects for an organization.",
    tags: [OpenAPITags.Redirect],
    request: {
        params: paramsSchema,
        query: listSchema
    },
    responses: {
        200: {
            description: "Successful response"
        }
    }
});

export async function listRedirects(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = listSchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error).toString()
                )
            );
        }

        const parsedParams = paramsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { orgId } = parsedParams.data;

        if (req.user && orgId && orgId !== req.userOrgId) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not have access to this organization"
                )
            );
        }

        const { pageSize, page, query } = parsedQuery.data;
        const conditions = [eq(redirects.orgId, orgId)];

        if (query) {
            conditions.push(
                like(
                    sql`LOWER(${redirects.name})`,
                    "%" + query.toLowerCase() + "%"
                )
            );
        }

        const baseQuery = db
            .select()
            .from(redirects)
            .where(and(...conditions));

        const countQuery = db.$count(
            db
                .select()
                .from(redirects)
                .where(and(...conditions))
                .as("filtered_redirects")
        );

        const [totalCount, rows] = await Promise.all([
            countQuery,
            baseQuery
                .limit(pageSize)
                .offset(pageSize * (page - 1))
                .orderBy(asc(redirects.name))
        ]);

        return response<ListRedirectsResponse>(res, {
            data: {
                redirects: rows,
                pagination: {
                    total: totalCount,
                    pageSize,
                    page
                }
            },
            success: true,
            error: false,
            message: "Redirects retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
