import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { siteResources, SiteResource } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { eq, and } from "drizzle-orm";
import { fromError } from "zod-validation-error";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";

const getSiteResourceParamsSchema = z.strictObject({
    siteResourceId: z
        .string()
        .optional()
        .transform((val) => (val ? Number(val) : undefined))
        .pipe(z.int().positive().optional())
        .optional(),
    niceId: z.string().optional(),
    orgId: z.string()
});

async function query(siteResourceId?: number, niceId?: string, orgId?: string) {
    if (siteResourceId && orgId) {
        const [siteResource] = await db
            .select()
            .from(siteResources)
            .where(
                and(
                    eq(siteResources.siteResourceId, siteResourceId),
                    eq(siteResources.orgId, orgId)
                )
            )
            .limit(1);
        return siteResource;
    } else if (niceId && orgId) {
        const [siteResource] = await db
            .select()
            .from(siteResources)
            .where(
                and(
                    eq(siteResources.niceId, niceId),
                    eq(siteResources.orgId, orgId)
                )
            )
            .limit(1);
        return siteResource;
    }
}

export type GetSiteResourceResponse = NonNullable<
    Awaited<ReturnType<typeof query>>
>;

registry.registerPath({
    method: "get",
    path: "/site-resource/{siteResourceId}",
    description: "Get a specific site resource by siteResourceId.",
    tags: [OpenAPITags.PrivateResource],
    request: {
        params: z.object({
            siteResourceId: z.number(),
            siteId: z.number(),
            orgId: z.string()
        })
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: z.object({
                        data: z.record(z.string(), z.any()).nullable(),
                        success: z.boolean(),
                        error: z.boolean(),
                        message: z.string(),
                        status: z.number()
                    })
                }
            }
        }
    }
});

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/site/{siteId}/resource/nice/{niceId}",
    description: "Get a specific site resource by niceId.",
    tags: [OpenAPITags.PrivateResource],
    request: {
        params: z.object({
            niceId: z.string(),
            orgId: z.string()
        })
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: z.object({
                        data: z.record(z.string(), z.any()).nullable(),
                        success: z.boolean(),
                        error: z.boolean(),
                        message: z.string(),
                        status: z.number()
                    })
                }
            }
        }
    }
});

export async function getSiteResource(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = getSiteResourceParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { siteResourceId, niceId, orgId } = parsedParams.data;

        // Get the site resource
        const siteResource = await query(siteResourceId, niceId, orgId);

        if (!siteResource) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Site resource not found")
            );
        }

        return response(res, {
            data: siteResource,
            success: true,
            error: false,
            message: "Site resource retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error("Error getting site resource:", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to get site resource"
            )
        );
    }
}
