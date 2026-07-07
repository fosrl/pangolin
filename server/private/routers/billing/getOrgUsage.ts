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

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { orgs } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromZodError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { Limit, limits, Usage, usage } from "@server/db";
import { usageService } from "@server/lib/billing/usageService";
import { LimitId } from "@server/lib/billing";
import { GetOrgUsageResponse } from "@server/routers/billing/types";

const getOrgSchema = z.strictObject({
    orgId: z.string()
});

// registry.registerPath({
//     method: "get",
//     path: "/org/{orgId}/billing/usage",
//     description: "Get an organization's billing usage",
//     tags: [OpenAPITags.Org],
//     request: {
//         params: getOrgSchema
//     },
// responses: {
// 200: {
// description: "Successful response",
// content: {
// "application/json": {
// schema: z.object({
// data: z.record(z.string(), z.any()).nullable(),
// success: z.boolean(),
// error: z.boolean(),
// message: z.string(),
// status: z.number()
// })
// }
// }
// }
// }
// });

export async function getOrgUsage(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = getOrgSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsedParams.error)
                )
            );
        }

        const { orgId } = parsedParams.data;

        const org = await db
            .select()
            .from(orgs)
            .where(eq(orgs.orgId, orgId))
            .limit(1);

        if (org.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Organization with ID ${orgId} not found`
                )
            );
        }

        // Get usage for org
        const usageData = [];

        const sites = await usageService.getUsage(orgId, LimitId.SITES);
        const users = await usageService.getUsage(orgId, LimitId.USERS);
        const domains = await usageService.getUsage(orgId, LimitId.DOMAINS);
        const remoteExitNodes = await usageService.getUsage(
            orgId,
            LimitId.REMOTE_EXIT_NODES
        );
        const organizations = await usageService.getUsage(
            orgId,
            LimitId.ORGANIZATIONS
        );
        const publicResources = await usageService.getUsage(
            orgId,
            LimitId.PUBLIC_RESOURCES
        );
        const privateResources = await usageService.getUsage(
            orgId,
            LimitId.PRIVATE_RESOURCES
        );
        const machineClients = await usageService.getUsage(
            orgId,
            LimitId.MACHINE_CLIENTS
        );
        // const egressData = await usageService.getUsage(
        //     orgId,
        //     FeatureId.EGRESS_DATA_MB
        // );

        if (sites) {
            usageData.push(sites);
        }
        if (users) {
            usageData.push(users);
        }
        // if (egressData) {
        //     usageData.push(egressData);
        // }
        if (domains) {
            usageData.push(domains);
        }
        if (remoteExitNodes) {
            usageData.push(remoteExitNodes);
        }
        if (organizations) {
            usageData.push(organizations);
        }
        if (publicResources) {
            usageData.push(publicResources);
        }
        if (privateResources) {
            usageData.push(privateResources);
        }
        if (machineClients) {
            usageData.push(machineClients);
        }

        const orgLimits = await db
            .select()
            .from(limits)
            .where(eq(limits.orgId, orgId));

        return response<GetOrgUsageResponse>(res, {
            data: {
                usage: usageData,
                limits: orgLimits
            },
            success: true,
            error: false,
            message: "Organization usage retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
