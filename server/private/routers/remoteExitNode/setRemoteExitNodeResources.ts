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

import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import {
    db,
    newts,
    remoteExitNodeResources,
    remoteExitNodes,
    sites
} from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { sendToClientsBatch } from "#private/routers/ws";
import { canCompress } from "@server/lib/clientVersionChecks";
import { SetRemoteExitNodeResourcesResponse } from "@server/routers/remoteExitNode";

const paramsSchema = z.strictObject({
    orgId: z.string().min(1),
    remoteExitNodeId: z.string().min(1)
});

const cidrRegex =
    /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])(\/([0-9]|[1-2][0-9]|3[0-2]))$|^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9]))(\/([0-9]|[1-9][0-9]|1[0-1][0-9]|12[0-8]))$/;

const bodySchema = z.strictObject({
    destinations: z.array(
        z.string().regex(cidrRegex, "Must be a valid CIDR range")
    )
});

export type SetRemoteExitNodeResourcesBody = z.infer<typeof bodySchema>;

export async function setRemoteExitNodeResources(
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

        const { remoteExitNodeId } = parsedParams.data;

        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { destinations } = parsedBody.data;

        const [remoteExitNode] = await db
            .select()
            .from(remoteExitNodes)
            .where(eq(remoteExitNodes.remoteExitNodeId, remoteExitNodeId))
            .limit(1);

        if (!remoteExitNode) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Remote exit node with ID ${remoteExitNodeId} not found`
                )
            );
        }

        // Replace all resources atomically
        await db
            .delete(remoteExitNodeResources)
            .where(
                eq(remoteExitNodeResources.remoteExitNodeId, remoteExitNodeId)
            );

        if (destinations.length > 0) {
            await db.insert(remoteExitNodeResources).values(
                destinations.map((destination) => ({
                    remoteExitNodeId,
                    destination
                }))
            );
        }

        const resources = await db
            .select()
            .from(remoteExitNodeResources)
            .where(
                eq(remoteExitNodeResources.remoteExitNodeId, remoteExitNodeId)
            );

        // Notify all newts connected to this remote exit node's exit node
        if (remoteExitNode.exitNodeId) {
            const connectedNewts = await db
                .select({ newtId: newts.newtId, version: newts.version })
                .from(newts)
                .innerJoin(sites, eq(newts.siteId, sites.siteId))
                .where(eq(sites.exitNodeId, remoteExitNode.exitNodeId));

            await sendToClientsBatch(
                connectedNewts.map(({ newtId, version }) => ({
                    clientId: newtId,
                    message: {
                        type: "newt/wg/subnets/update",
                        data: { subnets: destinations }
                    },
                    options: {
                        incrementConfigVersion: true,
                        compress: canCompress(version, "newt")
                    }
                }))
            );
        }

        return response<SetRemoteExitNodeResourcesResponse>(res, {
            data: { resources },
            success: true,
            error: false,
            message: "Remote exit node resources updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
