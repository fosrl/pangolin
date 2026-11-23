import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { domains, orgDomains, orgs, users } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { createApiResponseSchema } from "@server/lib/openapi/createApiResponseSchema";

const listDomainsParamsSchema = z.strictObject({
    orgId: z.string()
});

const listDomainsSchema = z.strictObject({
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
            preferWildcardCert: domains.preferWildcardCert,
            errorMessage: domains.errorMessage
        })
        .from(orgDomains)
        .where(eq(orgDomains.orgId, orgId))
        .innerJoin(domains, eq(domains.domainId, orgDomains.domainId))
        .limit(limit)
        .offset(offset);

    // The other orgs each domain is shared with, so the dashboard can offer
    // unassociate (shared) or only delete (last org), and say which orgs
    // still use it.
    const domainIds = res.map((d) => d.domainId);
    const otherLinks =
        domainIds.length > 0
            ? await db
                  .select({
                      domainId: orgDomains.domainId,
                      orgId: orgs.orgId,
                      orgName: orgs.name
                  })
                  .from(orgDomains)
                  .innerJoin(orgs, eq(orgs.orgId, orgDomains.orgId))
                  .where(
                      and(
                          inArray(orgDomains.domainId, domainIds),
                          ne(orgDomains.orgId, orgId)
                      )
                  )
                  .orderBy(orgs.name)
            : [];
    const othersById = new Map<string, { orgId: string; orgName: string }[]>();
    for (const link of otherLinks) {
        const list = othersById.get(link.domainId) ?? [];
        list.push({ orgId: link.orgId, orgName: link.orgName });
        othersById.set(link.domainId, list);
    }

    return res.map((d) => {
        const sharedWithOrgs = othersById.get(d.domainId) ?? [];
        return {
            ...d,
            orgCount: sharedWithOrgs.length + 1,
            sharedWithOrgs
        };
    });
}

export type ListDomainsResponse = {
    domains: NonNullable<Awaited<ReturnType<typeof queryDomains>>>;
    pagination: { total: number; limit: number; offset: number };
};

const ListDomainsResponseDataSchema = z.object({
    domains: z.array(
        z.object({
            domainId: z.string(),
            baseDomain: z.string(),
            verified: z.boolean(),
            type: z.string().nullable(),
            failed: z.boolean(),
            tries: z.number(),
            configManaged: z.boolean(),
            certResolver: z.string().nullable(),
            preferWildcardCert: z.boolean().nullable(),
            errorMessage: z.string().nullable(),
            orgCount: z.number(),
            sharedWithOrgs: z.array(
                z.object({ orgId: z.string(), orgName: z.string() })
            )
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
    path: "/org/{orgId}/domains",
    description: "List all domains for a organization.",
    tags: [OpenAPITags.Domain],
    request: {
        params: z.object({
            orgId: z.string()
        }),
        query: listDomainsSchema
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: createApiResponseSchema(
                        ListDomainsResponseDataSchema
                    )
                }
            }
        }
    }
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
            .from(orgDomains)
            .where(eq(orgDomains.orgId, orgId));

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
