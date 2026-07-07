import { Request, Response, NextFunction } from "express";
import z from "zod";
import { OpenAPITags, registry } from "@server/openApi";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { fromError } from "zod-validation-error";
import { db, orgs, resourcePolicies, type ResourcePolicy } from "@server/db";
import { and, eq } from "drizzle-orm";
import logger from "@server/logger";
import response from "@server/lib/response";

const updateResourcePolicyParamsSchema = z.strictObject({
    resourcePolicyId: z.string().transform(Number).pipe(z.int().positive())
});

const updateResourcePolicyBodySchema = z.strictObject({
    name: z.string().min(1).max(255).optional(),
    niceId: z.string().min(1).max(255).optional()
});

registry.registerPath({
    method: "put",
    path: "/resource-policy/{resourcePolicyId}",
    description: "Update a resource policy.",
    tags: [OpenAPITags.Org, OpenAPITags.Policy],
    request: {
        params: updateResourcePolicyParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: updateResourcePolicyBodySchema
                }
            }
        }
    },
    responses: {}
});

export async function updateResourcePolicy(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const parsedParams = updateResourcePolicyParamsSchema.safeParse(
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

        if (req.user && req.userOrgRoleIds?.length === 0) {
            return next(
                createHttpError(HttpCode.FORBIDDEN, "User does not have a role")
            );
        }

        const { resourcePolicyId } = parsedParams.data;
        const [result] = await db
            .select()
            .from(resourcePolicies)
            .where(eq(resourcePolicies.resourcePolicyId, resourcePolicyId))
            .leftJoin(orgs, eq(resourcePolicies.orgId, orgs.orgId));

        const policy = result?.resourcePolicies;
        const org = result?.orgs;

        if (!policy || !org) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource Policy with ID ${resourcePolicyId} not found`
                )
            );
        }

        const parsedBody = updateResourcePolicyBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const updateData = parsedBody.data;

        if (updateData.niceId) {
            const [existingPolicy] = await db
                .select()
                .from(resourcePolicies)
                .where(
                    and(
                        eq(resourcePolicies.niceId, updateData.niceId),
                        eq(resourcePolicies.orgId, policy.orgId)
                    )
                );

            if (
                existingPolicy &&
                existingPolicy.resourcePolicyId !== policy.resourcePolicyId
            ) {
                return next(
                    createHttpError(
                        HttpCode.CONFLICT,
                        `A resource policy with niceId "${updateData.niceId}" already exists`
                    )
                );
            }
        }

        const updatedPolicy = await db.transaction(async (trx) => {
            const [updated] = await trx
                .update(resourcePolicies)
                .set({
                    ...updateData
                })
                .where(
                    eq(
                        resourcePolicies.resourcePolicyId,
                        policy.resourcePolicyId
                    )
                )
                .returning();

            return updated;
        });

        if (!updatedPolicy) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Failed to update policy"
                )
            );
        }

        return response<ResourcePolicy>(res, {
            data: updatedPolicy,
            success: true,
            error: false,
            message: "Resource policy updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
