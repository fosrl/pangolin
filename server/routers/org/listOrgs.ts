import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { Org, orgs, userOrgs } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { sql, inArray, eq } from "drizzle-orm";
import logger from "@server/logger";
import { fromZodError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { createApiResponseSchema } from "@server/lib/openapi/createApiResponseSchema";

const listOrgsSchema = z.strictObject({
    limit: z
        .string()
        .optional()
        .default("1000")
        .transform(Number)
        .pipe(z.int().positive()),
    offset: z
        .string()
        .optional()
        .default("0")
        .transform(Number)
        .pipe(z.int().nonnegative())
});

const ListOrgsResponseDataSchema = z.object({
    orgs: z.array(z.object({}).passthrough()),
    pagination: z.object({
        total: z.number(),
        limit: z.number(),
        offset: z.number()
    })
});

registry.registerPath({
    method: "get",
    path: "/orgs",
    description: "List all organizations in the system.",
    tags: [OpenAPITags.Org],
    request: {
        query: listOrgsSchema
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: createApiResponseSchema(ListOrgsResponseDataSchema)
                }
            }
        }
    }
});

export type ListOrgsResponse = {
    orgs: Org[];
    pagination: { total: number; limit: number; offset: number };
};

export async function listOrgs(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = listOrgsSchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsedQuery.error)
                )
            );
        }

        const { limit, offset } = parsedQuery.data;

        const organizations = await db
            .select()
            .from(orgs)
            .limit(limit)
            .offset(offset);

        const totalCountResult = await db
            .select({ count: sql<number>`cast(count(*) as integer)` })
            .from(orgs);
        const totalCount = totalCountResult[0].count;

        return response<ListOrgsResponse>(res, {
            data: {
                orgs: organizations,
                pagination: {
                    total: totalCount,
                    limit,
                    offset
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
