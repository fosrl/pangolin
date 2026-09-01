import { db, labels } from "@server/db";
import response from "@server/lib/response";
import logger from "@server/logger";
import type { ListOrgLabelsResponse } from "@server/routers/labels/types";
import HttpCode from "@server/types/HttpCode";
import { and, asc, eq, like, sql } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty()
});

const listLabelsSchema = z.object({
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
    query: z.string().optional()
});

function queryLabelsBase() {
    return db
        .select({
            labelId: labels.labelId,
            name: labels.name,
            color: labels.color
        })
        .from(labels);
}

export async function listOrgLabels(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = listLabelsSchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error)
                )
            );
        }

        const parsedParams = paramsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error)
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

        const conditions = [and(eq(labels.orgId, orgId))];

        if (query) {
            conditions.push(
                like(
                    sql`LOWER(${labels.name})`,
                    "%" + query.toLowerCase() + "%"
                )
            );
        }

        const baseQuery = queryLabelsBase().where(and(...conditions));

        // we need to add `as` so that drizzle filters the result as a subquery
        const countQuery = db.$count(
            queryLabelsBase()
                .where(and(...conditions))
                .as("filtered_labels")
        );

        const labelListQuery = baseQuery
            .limit(pageSize)
            .offset(pageSize * (page - 1))
            .orderBy(asc(labels.name));

        const [totalCount, rows] = await Promise.all([
            countQuery,
            labelListQuery
        ]);

        return response<ListOrgLabelsResponse>(res, {
            data: {
                labels: rows,
                pagination: {
                    total: totalCount,
                    pageSize,
                    page
                }
            },
            success: true,
            error: false,
            message: "Labels retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
