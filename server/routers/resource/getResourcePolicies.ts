import { db, resources } from "@server/db";
import {
    queryResourcePolicy,
    type GetResourcePolicyResponse
} from "@server/routers/policy/getResourcePolicy";
import response from "@server/lib/response";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";
import HttpCode from "@server/types/HttpCode";
import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import z from "zod";
import { fromError } from "zod-validation-error";

const getResourcePoliciesParamsSchema = z.strictObject({
    resourceId: z.string().transform(Number).pipe(z.int().positive())
});

export type GetResourcePoliciesResponse = {
    defaultPolicy: GetResourcePolicyResponse;
    sharedPolicy: GetResourcePolicyResponse | null;
};

registry.registerPath({
    method: "get",
    path: "/resource/{resourceId}/policies",
    description: "Get the inline and shared policies associated with a resource.",
    tags: [OpenAPITags.PublicResource, OpenAPITags.Policy],
    request: {
        params: getResourcePoliciesParamsSchema
    },
    responses: {}
});

export async function getResourcePolicies(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = getResourcePoliciesParamsSchema.safeParse(
            req.params
        );
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { resourceId } = parsedParams.data;

        const [resource] = await db
            .select({
                defaultResourcePolicyId: resources.defaultResourcePolicyId,
                resourcePolicyId: resources.resourcePolicyId
            })
            .from(resources)
            .where(eq(resources.resourceId, resourceId))
            .limit(1);

        if (!resource) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Resource not found")
            );
        }

        if (!resource.defaultResourcePolicyId) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "Resource has no default policy"
                )
            );
        }

        const [defaultPolicy, sharedPolicy] = await Promise.all([
            queryResourcePolicy({
                resourcePolicyId: resource.defaultResourcePolicyId
            }),
            resource.resourcePolicyId
                ? queryResourcePolicy({
                      resourcePolicyId: resource.resourcePolicyId
                  })
                : null
        ]);

        return response<GetResourcePoliciesResponse>(res, {
            data: {
                defaultPolicy:
                    // the policy will always be non nullable
                    defaultPolicy as unknown as GetResourcePolicyResponse,
                sharedPolicy
            },
            success: true,
            error: false,
            message: "Resource policies retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
