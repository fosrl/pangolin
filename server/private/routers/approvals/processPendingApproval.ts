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

import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";

import { approvals, clients, db, orgs, type Approval } from "@server/db";
import response from "@server/lib/response";
import { and, eq, type InferInsertModel } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";

const paramsSchema = z.strictObject({
    orgId: z.string(),
    approvalId: z.coerce.number().int().positive()
});

const bodySchema = z.strictObject({
    decision: z.enum(["approved", "denied"])
});

export type ProcessApprovalResponse = Approval;

export async function processPendingApproval(
    req: Request,
    res: Response,
    next: NextFunction
) {
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

        const parsedBody = bodySchema.safeParse(req.body);

        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { orgId, approvalId } = parsedParams.data;
        const updateData = parsedBody.data;

        const approval = await db
            .select()
            .from(approvals)
            .where(
                and(
                    eq(approvals.approvalId, approvalId),
                    eq(approvals.decision, "pending")
                )
            )
            .innerJoin(orgs, eq(approvals.orgId, approvals.orgId))
            .limit(1);

        if (approval.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Pending Approval with ID ${approvalId} not found`
                )
            );
        }

        const [updatedApproval] = await db
            .update(approvals)
            .set(updateData)
            .where(eq(approvals.approvalId, approvalId))
            .returning();

        // Update user device approval state too
        if (
            updatedApproval.type === "user_device" &&
            updatedApproval.clientId
        ) {
            const updateDataBody: Partial<InferInsertModel<typeof clients>> = {
                approvalState: updateData.decision
            };

            if (updateData.decision === "denied") {
                updateDataBody.blocked = true;
            }

            await db
                .update(clients)
                .set(updateDataBody)
                .where(eq(clients.clientId, updatedApproval.clientId));
        }

        return response(res, {
            data: updatedApproval,
            success: true,
            error: false,
            message: "Approval updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
