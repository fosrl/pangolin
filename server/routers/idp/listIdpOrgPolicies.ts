import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { idpOrg } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { eq, sql } from "drizzle-orm";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { createApiResponseSchema } from "@server/lib/openapi/createApiResponseSchema";

const paramsSchema = z.object({
    idpId: z.coerce.number<number>()
});

const querySchema = z.strictObject({
    limit: z
        .string()
        .optional()
        .default("1000")
        .transform(Number)
        .pipe(z.int().nonnegative()),
    offset: z
        .string()
        .optional()
        .default("0")
        .transform(Number)
        .pipe(z.int().nonnegative())
});

async function query(idpId: number, limit: number, offset: number) {
    const res = await db
        .select()
        .from(idpOrg)
        .where(eq(idpOrg.idpId, idpId))
        .limit(limit)
        .offset(offset);
    return res;
}

export type ListIdpOrgPoliciesResponse = {
    policies: NonNullable<Awaited<ReturnType<typeof query>>>;
    pagination: { total: number; limit: number; offset: number };
};

const ListIdpOrgPoliciesResponseDataSchema = z.object({
    policies: z.array(
        z.object({
            idpId: z.number(),
            orgId: z.string(),
            assignDefaultOrgRoleId: z.number().nullable()
        })
    ),
    pagination: z.object({
        total: z.number(),
        limit: z.number(),
        offset: z.number()
    })
});

registry.registerPath({
    method: "get",
    path: "/idp/{idpId}/org",
    description: "List all org policies on an IDP.",
    tags: [OpenAPITags.GlobalIdp],
    request: {
        params: paramsSchema,
        query: querySchema
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: createApiResponseSchema(
                        ListIdpOrgPoliciesResponseDataSchema
                    )
                }
            }
        }
    }
});

export async function listIdpOrgPolicies(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = paramsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }
        const { idpId } = parsedParams.data;

        const parsedQuery = querySchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error).toString()
                )
            );
        }
        const { limit, offset } = parsedQuery.data;

        const list = await query(idpId, limit, offset);

        const [{ count }] = await db
            .select({ count: sql<number>`count(*)` })
            .from(idpOrg)
            .where(eq(idpOrg.idpId, idpId));

        return response<ListIdpOrgPoliciesResponse>(res, {
            data: {
                policies: list,
                pagination: {
                    total: count,
                    limit,
                    offset
                }
            },
            success: true,
            error: false,
            message: "Policies retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
