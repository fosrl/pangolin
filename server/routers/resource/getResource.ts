import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { Resource, resources, sites } from "@server/db";
import { eq, and } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { fromError } from "zod-validation-error";
import logger from "@server/logger";
import stoi from "@server/lib/stoi";
import { OpenAPITags, registry } from "@server/openApi";

const getResourceSchema = z.strictObject({
    resourceId: z
        .string()
        .optional()
        .transform(stoi)
        .pipe(z.int().positive().optional())
        .optional(),
    niceId: z.string().optional(),
    orgId: z.string().optional()
});

async function query(resourceId?: number, niceId?: string, orgId?: string) {
    if (resourceId) {
        const [res] = await db
            .select()
            .from(resources)
            .where(eq(resources.resourceId, resourceId))
            .limit(1);
        return res;
    } else if (niceId && orgId) {
        const [res] = await db
            .select()
            .from(resources)
            .where(
                and(eq(resources.niceId, niceId), eq(resources.orgId, orgId))
            )
            .limit(1);
        return res;
    }
}

export type GetResourceResponse = Omit<
    NonNullable<Awaited<ReturnType<typeof query>>>,
    "headers" | "redirectDomains"
> & {
    headers: { name: string; value: string }[] | null;
    redirectDomains: string[] | null;
};

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/resource/{niceId}",
    description:
        "Get a resource by orgId and niceId. NiceId is a readable ID for the resource and unique on a per org basis.",
    tags: [OpenAPITags.Org, OpenAPITags.Resource],
    request: {
        params: z.object({
            orgId: z.string(),
            niceId: z.string()
        })
    },
    responses: {}
});

registry.registerPath({
    method: "get",
    path: "/resource/{resourceId}",
    description: "Get a resource by resourceId.",
    tags: [OpenAPITags.Resource],
    request: {
        params: z.object({
            resourceId: z.number()
        })
    },
    responses: {}
});

export async function getResource(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = getResourceSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { resourceId, niceId, orgId } = parsedParams.data;

        const resource = await query(resourceId, niceId, orgId);

        if (!resource) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Resource not found")
            );
        }

        let parsedHeaders: { name: string; value: string }[] | null = null;
        if (resource.headers) {
            try {
                parsedHeaders = JSON.parse(resource.headers);
            } catch {
                parsedHeaders = null;
            }
        }

        let parsedRedirectDomains: string[] | null = null;
        if (resource.redirectDomains) {
            try {
                parsedRedirectDomains = JSON.parse(resource.redirectDomains);
            } catch {
                parsedRedirectDomains = null;
            }
        }

        return response<GetResourceResponse>(res, {
            data: {
                ...resource,
                headers: parsedHeaders,
                redirectDomains: parsedRedirectDomains
            },
            success: true,
            error: false,
            message: "Resource retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
