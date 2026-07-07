import { db, resourcePolicies, resources } from "@server/db";
import response from "@server/lib/response";
import stoi from "@server/lib/stoi";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";
import HttpCode from "@server/types/HttpCode";
import { and, eq } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { applyInlinePolicyFields } from "./inlinePolicyFields";

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

async function queryInlinePolicy(resourcePolicyId: number) {
    const [res] = await db
        .select()
        .from(resourcePolicies)
        .where(eq(resourcePolicies.resourcePolicyId, resourcePolicyId))
        .limit(1);
    return res;
}

export type GetResourceResponse = Omit<
    NonNullable<Awaited<ReturnType<typeof query>>>,
    "requestHeaders" | "responseHeaders"
> & {
    requestHeaders: { name: string; value: string }[] | null;
    responseHeaders: { name: string; value: string }[] | null;
};

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/resource/{niceId}",
    description:
        "Get a resource by orgId and niceId. NiceId is a readable ID for the resource and unique on a per org basis.",
    tags: [OpenAPITags.PublicResource],
    request: {
        params: z.object({
            orgId: z.string(),
            niceId: z.string()
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
    path: "/resource/{resourceId}",
    description: "Get a resource by resourceId.",
    tags: [OpenAPITags.PublicResource],
    request: {
        params: z.object({
            resourceId: z.number()
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

        const isInlinePolicy =
            resource.resourcePolicyId === null &&
            resource.defaultResourcePolicyId !== null;

        let returnData = resource;
        if (isInlinePolicy) {
            // get the policy
            const policy = await queryInlinePolicy(
                resource.defaultResourcePolicyId!
            );
            returnData = applyInlinePolicyFields(returnData, policy);
        }

        return response<GetResourceResponse>(res, {
            data: {
                ...returnData,
                requestHeaders: returnData.requestHeaders
                    ? JSON.parse(returnData.requestHeaders)
                    : returnData.requestHeaders,
                responseHeaders: returnData.responseHeaders
                    ? JSON.parse(returnData.responseHeaders)
                    : returnData.responseHeaders
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
