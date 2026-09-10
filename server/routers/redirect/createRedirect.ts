import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, domains, orgDomains, redirects, resources } from "@server/db";
import type { Redirect } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, eq } from "drizzle-orm";
import {
    redirectMatchPathSchema,
    redirectPathMatchTypeSchema,
    redirectRewritePathSchema,
    redirectRewritePathTypeSchema
} from "@server/routers/redirect/validation";
import { getUniqueRedirectName } from "@server/db/names";

export type CreateRedirectResponse = {
    redirect: Redirect;
};

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty()
});

const bodySchema = z.strictObject({
    name: z.string().nonempty(),
    resourceId: z.number().int().positive().optional().nullable(),
    domainId: z.string().nonempty().optional().nullable(),
    subdomain: z.string().nonempty().optional().nullable(),
    destinationDomain: z.string().nonempty(),
    pathMatchType: redirectPathMatchTypeSchema.optional(),
    matchPath: redirectMatchPathSchema,
    rewritePath: redirectRewritePathSchema.optional().nullable(),
    rewritePathType: redirectRewritePathTypeSchema.optional().nullable(),
    permanent: z.boolean().optional(),
    enabled: z.boolean().optional()
}).refine(
    (data) =>
        // stripPrefix removes the matched prefix and needs no replacement
        // value; every other rewrite type is meaningless without one.
        !data.rewritePathType ||
        data.rewritePathType === "stripPrefix" ||
        Boolean(data.rewritePath),
    {
        message:
            "rewritePath is required unless rewritePathType is stripPrefix",
        path: ["rewritePath"]
    }
);

registry.registerPath({
    method: "put",
    path: "/org/{orgId}/redirect",
    description: "Create a redirect for an organization.",
    tags: [OpenAPITags.Redirect],
    request: {
        params: paramsSchema,
        body: {
            content: {
                "application/json": {
                    schema: bodySchema
                }
            }
        }
    },
    responses: {
        201: {
            description: "Successful response"
        }
    }
});

export async function createRedirect(
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

        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { orgId } = parsedParams.data;
        const {
            name,
            resourceId,
            domainId,
            subdomain,
            destinationDomain,
            pathMatchType,
            matchPath,
            rewritePath,
            rewritePathType,
            permanent,
            enabled
        } = parsedBody.data;

        if (resourceId) {
            const [resource] = await db
                .select({ resourceId: resources.resourceId })
                .from(resources)
                .where(
                    and(
                        eq(resources.resourceId, resourceId),
                        eq(resources.orgId, orgId)
                    )
                )
                .limit(1);

            if (!resource) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `Resource with ID ${resourceId} not found`
                    )
                );
            }
        }

        if (domainId) {
            const [domain] = await db
                .select({ domainId: domains.domainId })
                .from(domains)
                .innerJoin(
                    orgDomains,
                    eq(orgDomains.domainId, domains.domainId)
                )
                .where(
                    and(
                        eq(domains.domainId, domainId),
                        eq(orgDomains.orgId, orgId)
                    )
                )
                .limit(1);

            if (!domain) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `Domain with ID ${domainId} not found`
                    )
                );
            }
        }

        const niceId = await getUniqueRedirectName(orgId);

        const [redirect] = await db
            .insert(redirects)
            .values({
                orgId,
                name,
                niceId,
                resourceId: resourceId ?? null,
                domainId: domainId ?? null,
                subdomain: subdomain ?? null,
                destinationDomain,
                pathMatchType: pathMatchType ?? "regex",
                matchPath,
                rewritePath: rewritePath ?? null,
                rewritePathType: rewritePathType ?? null,
                permanent: permanent ?? false,
                enabled: enabled ?? true
            })
            .returning();

        return response<CreateRedirectResponse>(res, {
            data: {
                redirect
            },
            success: true,
            error: false,
            message: "Redirect created successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
