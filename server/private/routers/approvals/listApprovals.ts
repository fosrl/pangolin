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

import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";

import type { Request, Response, NextFunction } from "express";
import { build } from "@server/build";
import { getOrgTierData } from "@server/lib/billing";
import { TierId } from "@server/lib/billing/tiers";
import {
    approvals,
    clients,
    db,
    users,
    olms,
    currentFingerprint,
    type Approval
} from "@server/db";
import { eq, isNull, sql, not, and, desc } from "drizzle-orm";
import response from "@server/lib/response";
import { getUserDeviceName } from "@server/db/names";

const paramsSchema = z.strictObject({
    orgId: z.string()
});

const querySchema = z.strictObject({
    limit: z
        .string()
        .optional()
        .default("1000")
        .transform(Number)
        .pipe(z.int().nonnegative()),
    offset: z
        .string()
        .optional()
        .default("0")
        .transform(Number)
        .pipe(z.int().nonnegative()),
    approvalState: z
        .enum(["pending", "approved", "denied", "all"])
        .optional()
        .default("all")
        .catch("all"),
    clientId: z
        .string()
        .optional()
        .transform((val) => (val ? Number(val) : undefined))
        .pipe(z.number().int().positive().optional())
});

async function queryApprovals(
    orgId: string,
    limit: number,
    offset: number,
    approvalState: z.infer<typeof querySchema>["approvalState"],
    clientId?: number
) {
    let state: Array<Approval["decision"]> = [];
    switch (approvalState) {
        case "pending":
            state = ["pending"];
            break;
        case "approved":
            state = ["approved"];
            break;
        case "denied":
            state = ["denied"];
            break;
        default:
            state = ["approved", "denied", "pending"];
    }

    const res = await db
        .select({
            approvalId: approvals.approvalId,
            orgId: approvals.orgId,
            clientId: approvals.clientId,
            decision: approvals.decision,
            type: approvals.type,
            user: {
                name: users.name,
                userId: users.userId,
                username: users.username,
                email: users.email
            },
            clientName: clients.name,
            niceId: clients.niceId,
            deviceModel: currentFingerprint.deviceModel,
            fingerprintPlatform: currentFingerprint.platform,
            fingerprintOsVersion: currentFingerprint.osVersion,
            fingerprintKernelVersion: currentFingerprint.kernelVersion,
            fingerprintArch: currentFingerprint.arch,
            fingerprintSerialNumber: currentFingerprint.serialNumber,
            fingerprintUsername: currentFingerprint.username,
            fingerprintHostname: currentFingerprint.hostname
        })
        .from(approvals)
        .innerJoin(users, and(eq(approvals.userId, users.userId)))
        .leftJoin(
            clients,
            and(
                eq(approvals.clientId, clients.clientId),
                not(isNull(clients.userId)) // only user devices
            )
        )
        .leftJoin(olms, eq(clients.clientId, olms.clientId))
        .leftJoin(currentFingerprint, eq(olms.olmId, currentFingerprint.olmId))
        .where(
            and(
                eq(approvals.orgId, orgId),
                sql`${approvals.decision} in ${state}`,
                ...(clientId ? [eq(approvals.clientId, clientId)] : [])
            )
        )
        .orderBy(
            sql`CASE ${approvals.decision} WHEN 'pending' THEN 0 ELSE 1 END`,
            desc(approvals.timestamp)
        )
        .limit(limit)
        .offset(offset);

    // Process results to format device names and build fingerprint objects
    return res.map((approval) => {
        const model = approval.deviceModel || null;
        const deviceName = approval.clientName
            ? getUserDeviceName(model, approval.clientName)
            : null;

        // Build fingerprint object if any fingerprint data exists
        const hasFingerprintData =
            approval.fingerprintPlatform ||
            approval.fingerprintOsVersion ||
            approval.fingerprintKernelVersion ||
            approval.fingerprintArch ||
            approval.fingerprintSerialNumber ||
            approval.fingerprintUsername ||
            approval.fingerprintHostname ||
            approval.deviceModel;

        const fingerprint = hasFingerprintData
            ? {
                platform: approval.fingerprintPlatform || null,
                osVersion: approval.fingerprintOsVersion || null,
                kernelVersion: approval.fingerprintKernelVersion || null,
                arch: approval.fingerprintArch || null,
                deviceModel: approval.deviceModel || null,
                serialNumber: approval.fingerprintSerialNumber || null,
                username: approval.fingerprintUsername || null,
                hostname: approval.fingerprintHostname || null
            }
            : null;

        const {
            clientName,
            deviceModel,
            fingerprintPlatform,
            fingerprintOsVersion,
            fingerprintKernelVersion,
            fingerprintArch,
            fingerprintSerialNumber,
            fingerprintUsername,
            fingerprintHostname,
            ...rest
        } = approval;

        return {
            ...rest,
            deviceName,
            fingerprint,
            niceId: approval.niceId || null
        };
    });
}

export type ListApprovalsResponse = {
    approvals: NonNullable<Awaited<ReturnType<typeof queryApprovals>>>;
    pagination: { total: number; limit: number; offset: number };
};

export async function listApprovals(
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

        const parsedQuery = querySchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error).toString()
                )
            );
        }
        const { limit, offset, approvalState, clientId } = parsedQuery.data;

        const { orgId } = parsedParams.data;

        if (build === "saas") {
            const { tier } = await getOrgTierData(orgId);
            const subscribed = tier === TierId.STANDARD;
            if (!subscribed) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "This organization's current plan does not support this feature."
                    )
                );
            }
        }

        const approvalsList = await queryApprovals(
            orgId.toString(),
            limit,
            offset,
            approvalState,
            clientId
        );

        const [{ count }] = await db
            .select({ count: sql<number>`count(*)` })
            .from(approvals);

        return response<ListApprovalsResponse>(res, {
            data: {
                approvals: approvalsList,
                pagination: {
                    total: count,
                    limit,
                    offset
                }
            },
            success: true,
            error: false,
            message: "Approvals retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
