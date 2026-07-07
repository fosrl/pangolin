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
    labels,
    remoteExitNodePreferenceLabels,
    remoteExitNodes
} from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { ListRemoteExitNodePreferenceLabelsResponse } from "@server/routers/remoteExitNode";

const paramsSchema = z.strictObject({
    orgId: z.string().min(1),
    remoteExitNodeId: z.string().min(1)
});

export async function listRemoteExitNodePreferenceLabels(
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

        const rows = await db
            .select({
                remoteExitNodePreferenceLabelId:
                    remoteExitNodePreferenceLabels.remoteExitNodePreferenceLabelId,
                labelId: remoteExitNodePreferenceLabels.labelId,
                name: labels.name,
                color: labels.color
            })
            .from(remoteExitNodePreferenceLabels)
            .innerJoin(
                labels,
                eq(labels.labelId, remoteExitNodePreferenceLabels.labelId)
            )
            .where(
                eq(
                    remoteExitNodePreferenceLabels.remoteExitNodeId,
                    remoteExitNodeId
                )
            );

        return response<ListRemoteExitNodePreferenceLabelsResponse>(res, {
            data: { labels: rows },
            success: true,
            error: false,
            message:
                "Remote exit node preference labels retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
