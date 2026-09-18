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
import { and, eq, ne } from "drizzle-orm";
import {
    redirectNiceIdSchema,
    redirectDestinationDomainSchema,
    redirectMatchPathSchema,
    redirectPathMatchTypeSchema,
    redirectRewritePathSchema,
    redirectRewritePathTypeSchema,
    redirectPrioritySchema,
    isValidMatchPath,
    isAllowedSsl
} from "@server/routers/redirect/validation";
import { createCertificate } from "../certificates";

export type UpdateRedirectResponse = {
    redirect: Redirect;
};

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty(),
    redirectId: z.coerce.number().int().positive()
});

const bodySchema = z.strictObject({
    name: z.string().nonempty().optional(),
    niceId: redirectNiceIdSchema.optional(),
    resourceId: z.number().int().positive().optional().nullable(),
    domainId: z.string().nonempty().optional().nullable(),
    subdomain: z.string().nonempty().optional().nullable(),
    destinationDomain: redirectDestinationDomainSchema.optional(),
    pathMatchType: redirectPathMatchTypeSchema.optional(),
    matchPath: redirectMatchPathSchema.optional().nullable(),
    rewritePath: redirectRewritePathSchema.optional().nullable(),
    rewritePathType: redirectRewritePathTypeSchema.optional().nullable(),
    priority: redirectPrioritySchema.optional(),
    permanent: z.boolean().optional(),
    ssl: z.boolean().optional(),
    enabled: z.boolean().optional()
});

registry.registerPath({
    method: "post",
    path: "/org/{orgId}/redirects/{redirectId}",
    description: "Update a redirect.",
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
        200: {
            description: "Successful response"
        }
    }
});

export async function updateRedirect(
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

        const { orgId, redirectId } = parsedParams.data;
        const body = parsedBody.data;

        const [existing] = await db
            .select()
            .from(redirects)
            .where(
                and(
                    eq(redirects.redirectId, redirectId),
                    eq(redirects.orgId, orgId)
                )
            )
            .limit(1);

        if (!existing) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Redirect with ID ${redirectId} not found`
                )
            );
        }

        const effectiveResourceId =
            body.resourceId !== undefined
                ? body.resourceId
                : existing.resourceId;
        const effectiveDomainId =
            body.domainId !== undefined ? body.domainId : existing.domainId;

        if (Boolean(effectiveResourceId) === Boolean(effectiveDomainId)) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Exactly one of resourceId or domainId must be provided"
                )
            );
        }

        if (body.resourceId) {
            const [resource] = await db
                .select({ resourceId: resources.resourceId })
                .from(resources)
                .where(
                    and(
                        eq(resources.resourceId, body.resourceId),
                        eq(resources.orgId, existing.orgId)
                    )
                )
                .limit(1);

            if (!resource) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `Resource with ID ${body.resourceId} not found`
                    )
                );
            }
        }

        let domain: { domainId: string; baseDomain: string } | null = null;
        if (effectiveDomainId) {
            const [d] = await db
                .select({
                    domainId: domains.domainId,
                    baseDomain: domains.baseDomain
                })
                .from(domains)
                .innerJoin(
                    orgDomains,
                    eq(orgDomains.domainId, domains.domainId)
                )
                .where(
                    and(
                        eq(domains.domainId, effectiveDomainId),
                        eq(orgDomains.orgId, existing.orgId)
                    )
                )
                .limit(1);

            domain = d ?? null;
            if (!domain) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `Domain with ID ${effectiveDomainId} not found`
                    )
                );
            }
        }

        if (body.niceId) {
            const [existingNiceId] = await db
                .select()
                .from(redirects)
                .where(
                    and(
                        eq(redirects.niceId, body.niceId),
                        eq(redirects.orgId, existing.orgId),
                        ne(redirects.redirectId, existing.redirectId) // exclude the current redirect from the search
                    )
                )
                .limit(1);

            if (existingNiceId) {
                return next(
                    createHttpError(
                        HttpCode.CONFLICT,
                        `A redirect with niceId "${body.niceId}" already exists`
                    )
                );
            }
        }

        if (
            !isValidMatchPath(
                body.matchPath !== undefined
                    ? body.matchPath
                    : existing.matchPath,
                body.pathMatchType ?? existing.pathMatchType
            )
        ) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "matchPath must be a valid regular expression"
                )
            );
        }

        if (!isAllowedSsl(body.ssl)) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "TLS cannot be disabled on this build"
                )
            );
        }

        const updateData: Partial<typeof redirects.$inferInsert> = {};

        if (body.name !== undefined) {
            updateData.name = body.name;
        }
        if (body.niceId !== undefined) {
            updateData.niceId = body.niceId;
        }
        if (body.resourceId !== undefined) {
            updateData.resourceId = body.resourceId;
        }
        if (body.domainId !== undefined) {
            updateData.domainId = body.domainId;
        }
        if (body.subdomain !== undefined) {
            updateData.subdomain = body.subdomain;
        }
        if (body.destinationDomain !== undefined) {
            updateData.destinationDomain = body.destinationDomain;
        }
        if (body.pathMatchType !== undefined) {
            updateData.pathMatchType = body.pathMatchType;
        }
        if (body.matchPath !== undefined) {
            updateData.matchPath = body.matchPath;
        }
        if (body.rewritePath !== undefined) {
            updateData.rewritePath = body.rewritePath;
        }
        if (body.rewritePathType !== undefined) {
            updateData.rewritePathType = body.rewritePathType;
        }
        if (body.priority !== undefined) {
            updateData.priority = body.priority;
        }
        if (body.permanent !== undefined) {
            updateData.permanent = body.permanent;
        }
        if (effectiveResourceId) {
            // Resource-attached redirects follow the resource's ssl; reset
            // the column so a later move back to a domain starts from TLS on.
            updateData.ssl = true;
        } else if (body.ssl !== undefined) {
            updateData.ssl = body.ssl;
        }
        if (body.enabled !== undefined) {
            updateData.enabled = body.enabled;
        }

        const [redirect] = await db
            .update(redirects)
            .set(updateData)
            .where(
                and(
                    eq(redirects.redirectId, redirectId),
                    eq(redirects.orgId, orgId)
                )
            )
            .returning();

        if (domain) {
            const effectiveSubdomain =
                body.subdomain !== undefined
                    ? body.subdomain
                    : existing.subdomain;
            const fullDomain = [effectiveSubdomain ?? null, domain.baseDomain]
                .filter(Boolean)
                .join(".");
            await createCertificate(domain.domainId, fullDomain, db);
        }

        return response<UpdateRedirectResponse>(res, {
            data: {
                redirect
            },
            success: true,
            error: false,
            message: "Redirect updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
