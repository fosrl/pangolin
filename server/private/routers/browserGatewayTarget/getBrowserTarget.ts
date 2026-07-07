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
import { db, resources, targets } from "@server/db";
import { eq, and, inArray } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { fromError } from "zod-validation-error";
import logger from "@server/logger";
import { decrypt } from "@server/lib/crypto";
import config from "@server/lib/config";
import { GetBrowserTargetResponse } from "@server/routers/browserGatewayTarget";

const getBrowserTargetSchema = z
    .object({
        fullDomain: z.string().min(1, "fullDomain is required")
    })
    .strict();

export async function getBrowserTarget(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsed = getBrowserTargetSchema.safeParse(req.query);
        if (!parsed.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsed.error).toString()
                )
            );
        }

        const { fullDomain } = parsed.data;

        logger.info(`Retrieving browser target for domain: ${fullDomain}`);

        const [row] = await db
            .select({
                ip: targets.ip,
                port: targets.port,
                authToken: targets.authToken,
                resourceId: resources.resourceId,
                niceId: resources.niceId,
                name: resources.name,
                orgId: resources.orgId,
                pamMode: resources.pamMode,
                authDaemonMode: resources.authDaemonMode
            })
            .from(targets)
            .innerJoin(resources, eq(targets.resourceId, resources.resourceId))
            .where(
                and(
                    eq(resources.fullDomain, fullDomain),
                    eq(targets.enabled, true),
                    inArray(targets.mode, ["ssh", "rdp", "vnc"])
                )
            )
            .limit(1);

        if (!row) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "No resource found for this domain"
                )
            );
        }

        const decryptedAuthToken = row.authToken
            ? decrypt(row.authToken, config.getRawConfig().server.secret!)
            : "";

        return response<GetBrowserTargetResponse>(res, {
            data: {
                ip: row.ip,
                port: row.port,
                authToken: decryptedAuthToken,
                pamMode: row.pamMode,
                authDaemonMode: row.authDaemonMode,
                orgId: row.orgId,
                resourceId: row.resourceId,
                niceId: row.niceId,
                name: row.name ?? ""
            },
            success: true,
            error: false,
            message: "Browser target retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "An error occurred while retrieving the browser target"
            )
        );
    }
}
