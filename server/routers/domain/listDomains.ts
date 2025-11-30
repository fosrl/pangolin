import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { domains, orgDomains, users } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { eq, sql } from "drizzle-orm";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";

const listDomainsParamsSchema = z
    .object({
        orgId: z.string()
    })
    .strict();

const listDomainsSchema = z
    .object({
        limit: z
            .string()
            .optional()
            .default("1000")
            .transform(Number)
            .pipe(z.number().int().nonnegative()),
        offset: z
            .string()
            .optional()
            .default("0")
            .transform(Number)
            .pipe(z.number().int().nonnegative())
    })
    .strict();

async function queryDomains(orgId: string, limit: number, offset: number) {
    const res = await db
        .select({
            domainId: domains.domainId,
            baseDomain: domains.baseDomain,
            verified: domains.verified,
            type: domains.type,
            failed: domains.failed,
            tries: domains.tries,
            configManaged: domains.configManaged,
            certResolver: domains.certResolver,
            preferWildcardCert: domains.preferWildcardCert
        })
        .from(orgDomains)
        .where(eq(orgDomains.orgId, orgId))
        .innerJoin(domains, eq(domains.domainId, orgDomains.domainId))
        .limit(limit)
        .offset(offset);
    return res;
}

export type ListDomainsResponse = {
    domains: NonNullable<Awaited<ReturnType<typeof queryDomains>>>;
    pagination: { total: number; limit: number; offset: number };
};

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/domains",
    description: "List all domains for a organization.",
    tags: [OpenAPITags.Org],
    request: {
        params: z.object({
            orgId: z.string()
        }),
        query: listDomainsSchema
    },
    responses: {}
});

export async function listDomains(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = listDomainsSchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error).toString()
                )
            );
        }
        const { limit, offset } = parsedQuery.data;

        const parsedParams = listDomainsParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { orgId } = parsedParams.data;

        const domainsList = await queryDomains(orgId.toString(), limit, offset);

        const [{ count }] = await db
            .select({ count: sql<number>`count(*)` })
            .from(domains);

        return response<ListDomainsResponse>(res, {
            data: {
                domains: domainsList,
                pagination: {
                    total: count,
                    limit,
                    offset
                }
            },
            success: true,
            error: false,
            message: "Domains retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
