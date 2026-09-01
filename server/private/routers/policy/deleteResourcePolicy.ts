/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025-2026 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import { db, resourcePolicies, resources } from "@server/db";
import response from "@server/lib/response";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";
import HttpCode from "@server/types/HttpCode";
import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import z from "zod";
import { fromError } from "zod-validation-error";

// Define Zod schema for request parameters validation
const deleteResourcePolicySchema = z.strictObject({
    resourcePolicyId: z.string().transform(Number).pipe(z.int().positive())
});

registry.registerPath({
    method: "delete",
    path: "/resource-policy/{resourcePolicyId}",
    description: "Delete a resource policy.",
    tags: [OpenAPITags.PublicResourcePolicy],
    request: {
        params: deleteResourcePolicySchema
    },
    responses: {}
});

export async function deleteResourcePolicy(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = deleteResourcePolicySchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { resourcePolicyId } = parsedParams.data;

        const [existingResource] = await db
            .select()
            .from(resourcePolicies)
            .where(eq(resourcePolicies.resourcePolicyId, resourcePolicyId));

        if (!existingResource) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource Policy with ID ${resourcePolicyId} not found`
                )
            );
        }

        const totalAffectedResources = await db.$count(
            db
                .select()
                .from(resources)
                .where(eq(resources.resourcePolicyId, resourcePolicyId))
        );

        if (totalAffectedResources > 0) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    `Cannot delete Policy '${existingResource.name}' as it's being used by at least one resource`
                )
            );
        }

        // delete policy
        await db
            .delete(resourcePolicies)
            .where(eq(resourcePolicies.resourcePolicyId, resourcePolicyId));

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Resource Policy deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
