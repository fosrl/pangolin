import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { domains, redirects, resources, db } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import type { PaginatedResponse } from "@server/types/Pagination";

export type ListRedirectsResponse = PaginatedResponse<{
    redirects: Array<{
        redirectId: number;
        orgId: string;
        niceId: string;
        name: string;
        subdomain: string | null;
        destinationHost: string;
        pathMatchType: "exact" | "prefix" | "regex";
        matchPath: string | null;
        rewritePath: string | null;
        rewritePathType: "exact" | "prefix" | "regex" | "stripPrefix" | null;
        priority: number | null;
        permanent: boolean;
        ssl: boolean;
        enabled: boolean;
        resourceId: number | null;
        resourceName: string | null;
        resourceNiceId: string | null;
        resourceFullDomain: string | null;
        resourceDomainId: string | null;
        domainId: string | null;
        baseDomain: string | null;
    }>;
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
    query: z.string().optional(),
    sort_by: z
        .enum(["name", "priority"])
        .optional()
        .catch(undefined)
        .openapi({
            type: "string",
            enum: ["name", "priority"],
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
    type: z
        .enum(["permanent", "temporary"])
        .optional()
        .catch(undefined)
        .openapi({
            type: "string",
            enum: ["permanent", "temporary"],
            description:
                "Filter redirects by type. `permanent` is a 308 redirect and `temporary` is a 307 redirect."
        }),
    enabled: z
        .enum(["true", "false"])
        .transform((value) => value === "true")
        .optional()
        .catch(undefined)
        .openapi({
            type: "boolean",
            description: "Filter redirects based on enabled status"
        }),
    resourceId: z.coerce
        .number<string>()
        .int()
        .positive()
        .optional()
        .catch(undefined)
        .openapi({
            type: "integer",
            description: "Filter redirects attached to this resource"
        }),
    domainId: z.string().nonempty().optional().catch(undefined).openapi({
        type: "string",
        description: "Filter redirects attached to this domain"
    })
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

        const {
            pageSize,
            page,
            query,
            sort_by,
            order,
            type,
            enabled,
            resourceId,
            domainId
        } = parsedQuery.data;
        const conditions = [eq(redirects.orgId, orgId)];

        if (type === "permanent") {
            conditions.push(eq(redirects.permanent, true));
        } else if (type === "temporary") {
            conditions.push(eq(redirects.permanent, false));
        }

        if (typeof enabled !== "undefined") {
            conditions.push(eq(redirects.enabled, enabled));
        }

        if (typeof resourceId !== "undefined") {
            conditions.push(eq(redirects.resourceId, resourceId));
        }

        if (typeof domainId !== "undefined") {
            conditions.push(eq(redirects.domainId, domainId));
        }

        if (query) {
            const term = "%" + query.toLowerCase() + "%";
            conditions.push(
                or(
                    like(sql`LOWER(${redirects.name})`, term),
                    like(sql`LOWER(${redirects.matchPath})`, term),
                    like(sql`LOWER(${redirects.destinationHost})`, term)
                )!
            );
        }

        const baseQuery = db
            .select({
                redirectId: redirects.redirectId,
                orgId: redirects.orgId,
                niceId: redirects.niceId,
                name: redirects.name,
                subdomain: redirects.subdomain,
                destinationHost: redirects.destinationHost,
                pathMatchType: redirects.pathMatchType,
                matchPath: redirects.matchPath,
                rewritePath: redirects.rewritePath,
                rewritePathType: redirects.rewritePathType,
                priority: redirects.priority,
                permanent: redirects.permanent,
                ssl: redirects.ssl,
                enabled: redirects.enabled,
                resourceId: redirects.resourceId,
                resourceName: resources.name,
                resourceNiceId: resources.niceId,
                resourceFullDomain: resources.fullDomain,
                resourceDomainId: resources.domainId,
                domainId: redirects.domainId,
                baseDomain: domains.baseDomain
            })
            .from(redirects)
            .leftJoin(resources, eq(resources.resourceId, redirects.resourceId))
            .leftJoin(domains, eq(domains.domainId, redirects.domainId))
            .where(and(...conditions));

        const countQuery = db.$count(
            db
                .select()
                .from(redirects)
                .where(and(...conditions))
                .as("filtered_redirects")
        );

        // Null priority is shown as 100, so sort on that same value.
        const prioritySort = sql`COALESCE(${redirects.priority}, 100)`;
        const orderBy =
            sort_by === "name"
                ? order === "asc"
                    ? [asc(redirects.name), desc(redirects.redirectId)]
                    : [desc(redirects.name), desc(redirects.redirectId)]
                : sort_by === "priority"
                  ? order === "asc"
                      ? [asc(prioritySort), desc(redirects.redirectId)]
                      : [desc(prioritySort), desc(redirects.redirectId)]
                  : [desc(prioritySort), desc(redirects.redirectId)];

        const [totalCount, rows] = await Promise.all([
            countQuery,
            baseQuery
                .limit(pageSize)
                .offset(pageSize * (page - 1))
                .orderBy(...orderBy)
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
