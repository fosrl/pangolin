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
    redirectSourcePathSchema
} from "@server/routers/redirect/validation";

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
    sourcePath: redirectSourcePathSchema.optional(),
    destinationUrl: z.url().optional().nullable(),
    permanent: z.boolean().optional(),
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

        if (body.domainId) {
            const [domain] = await db
                .select({ domainId: domains.domainId })
                .from(domains)
                .innerJoin(
                    orgDomains,
                    eq(orgDomains.domainId, domains.domainId)
                )
                .where(
                    and(
                        eq(domains.domainId, body.domainId),
                        eq(orgDomains.orgId, existing.orgId)
                    )
                )
                .limit(1);

            if (!domain) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `Domain with ID ${body.domainId} not found`
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
        if (body.sourcePath !== undefined) {
            updateData.sourcePath = body.sourcePath;
        }
        if (body.destinationUrl !== undefined) {
            updateData.destinationUrl = body.destinationUrl;
        }
        if (body.permanent !== undefined) {
            updateData.permanent = body.permanent;
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
