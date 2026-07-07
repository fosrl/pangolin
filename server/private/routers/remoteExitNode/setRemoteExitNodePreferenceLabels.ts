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
import { and, eq, inArray } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { SetRemoteExitNodePreferenceLabelsResponse } from "@server/routers/remoteExitNode";

const paramsSchema = z.strictObject({
    orgId: z.string().min(1),
    remoteExitNodeId: z.string().min(1)
});

const bodySchema = z.strictObject({
    labelIds: z.array(z.number().int().positive())
});

export type SetRemoteExitNodePreferenceLabelsBody = z.infer<typeof bodySchema>;

export async function setRemoteExitNodePreferenceLabels(
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

        const { orgId, remoteExitNodeId } = parsedParams.data;

        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { labelIds } = parsedBody.data;

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

        // Validate all provided labelIds belong to this org
        if (labelIds.length > 0) {
            const existingLabels = await db
                .select({ labelId: labels.labelId })
                .from(labels)
                .where(
                    and(
                        eq(labels.orgId, orgId),
                        inArray(labels.labelId, labelIds)
                    )
                );

            if (existingLabels.length !== labelIds.length) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "One or more label IDs are invalid or do not belong to this organization"
                    )
                );
            }
        }

        // Replace all preference labels atomically
        await db
            .delete(remoteExitNodePreferenceLabels)
            .where(
                eq(
                    remoteExitNodePreferenceLabels.remoteExitNodeId,
                    remoteExitNodeId
                )
            );

        if (labelIds.length > 0) {
            await db.insert(remoteExitNodePreferenceLabels).values(
                labelIds.map((labelId) => ({
                    remoteExitNodeId,
                    labelId
                }))
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

        return response<SetRemoteExitNodePreferenceLabelsResponse>(res, {
            data: { labels: rows },
            success: true,
            error: false,
            message: "Remote exit node preference labels updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
