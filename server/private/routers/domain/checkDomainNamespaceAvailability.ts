/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { db, domainNamespaces, resources } from "@server/db";
import { inArray } from "drizzle-orm";
import { CheckDomainAvailabilityResponse } from "@server/routers/domain/types";
import { build } from "@server/build";
import { isSubscribed } from "#private/lib/isSubscribed";
import { tierMatrix } from "@server/lib/billing/tierMatrix";

const paramsSchema = z.strictObject({});

const querySchema = z.strictObject({
    subdomain: z.string(),
    // orgId: build === "saas" ? z.string() : z.string().optional() // Required for saas, optional otherwise
});

registry.registerPath({
    method: "get",
    path: "/domain/check-namespace-availability",
    description: "Check if a domain namespace is available based on subdomain",
    tags: [OpenAPITags.Domain],
    request: {
        params: paramsSchema,
        query: querySchema
    },
    responses: {}
});

export async function checkDomainNamespaceAvailability(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = querySchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error).toString()
                )
            );
        }
        const { subdomain } = parsedQuery.data;

        // if (
        //     build == "saas" &&
        //     !isSubscribed(orgId!, tierMatrix.domainNamespaces)
        // ) {
        //     // return not available
        //     return response<CheckDomainAvailabilityResponse>(res, {
        //         data: {
        //             available: false,
        //             options: []
        //         },
        //         success: true,
        //         error: false,
        //         message: "Your current subscription does not support custom domain namespaces. Please upgrade to access this feature.",
        //         status: HttpCode.OK
        //     });
        // }

        const namespaces = await db.select().from(domainNamespaces);
        let possibleDomains = namespaces.map((ns) => {
            const desired = `${subdomain}.${ns.domainNamespaceId}`;
            return {
                fullDomain: desired,
                domainId: ns.domainId,
                domainNamespaceId: ns.domainNamespaceId
            };
        });

        if (!possibleDomains.length) {
            return response<CheckDomainAvailabilityResponse>(res, {
                data: {
                    available: false,
                    options: []
                },
                success: true,
                error: false,
                message: "No domain namespaces available",
                status: HttpCode.OK
            });
        }

        const existingResources = await db
            .select()
            .from(resources)
            .where(
                inArray(
                    resources.fullDomain,
                    possibleDomains.map((d) => d.fullDomain)
                )
            );

        possibleDomains = possibleDomains.filter(
            (domain) =>
                !existingResources.some(
                    (resource) => resource.fullDomain === domain.fullDomain
                )
        );

        return response<CheckDomainAvailabilityResponse>(res, {
            data: {
                available: possibleDomains.length > 0,
                options: possibleDomains
            },
            success: true,
            error: false,
            message: "Domain namespaces checked successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
