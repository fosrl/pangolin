import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, idpOidcConfig } from "@server/db";
import { domains, idp, orgDomains, users, idpOrg } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { eq, sql } from "drizzle-orm";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { createApiResponseSchema } from "@server/lib/openapi/createApiResponseSchema";

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

async function query(limit: number, offset: number) {
    const res = await db
        .select({
            idpId: idp.idpId,
            name: idp.name,
            type: idp.type,
            variant: idpOidcConfig.variant,
            orgCount: sql<number>`count(${idpOrg.orgId})`,
            autoProvision: idp.autoProvision,
            tags: idp.tags
        })
        .from(idp)
        .leftJoin(idpOrg, sql`${idp.idpId} = ${idpOrg.idpId}`)
        .leftJoin(idpOidcConfig, eq(idpOidcConfig.idpId, idp.idpId))
        .groupBy(idp.idpId, idpOidcConfig.variant)
        .limit(limit)
        .offset(offset);
    return res;
}

export type ListIdpsResponse = {
    idps: Awaited<ReturnType<typeof query>>;
    pagination: {
        total: number;
        limit: number;
        offset: number;
    };
};

const ListIdpsResponseDataSchema = z.object({
    idps: z.array(
        z.object({
            idpId: z.number(),
            name: z.string(),
            type: z.string(),
            variant: z.string().nullable(),
            orgCount: z.number(),
            autoProvision: z.boolean().nullable(),
            tags: z.string().nullable()
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
    path: "/idp",
    description: "List all IDP in the system.",
    tags: [OpenAPITags.GlobalIdp],
    request: {
        query: querySchema
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: createApiResponseSchema(ListIdpsResponseDataSchema)
                }
            }
        }
    }
});

export async function listIdps(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
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

        const list = await query(limit, offset);

        const [{ count }] = await db
            .select({ count: sql<number>`count(*)` })
            .from(idp);

        return response<ListIdpsResponse>(res, {
            data: {
                idps: list,
                pagination: {
                    total: count,
                    limit,
                    offset
                }
            },
            success: true,
            error: false,
            message: "Idps retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
