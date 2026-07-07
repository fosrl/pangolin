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
import { db, ExitNodeOrg, exitNodeOrgs, exitNodes, orgs } from "@server/db";
import { remoteExitNodes } from "@server/db";
import { and, count, eq, inArray } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { usageService } from "@server/lib/billing/usageService";
import { LimitId } from "@server/lib/billing";

const paramsSchema = z.strictObject({
    orgId: z.string().min(1),
    remoteExitNodeId: z.string().min(1)
});

export async function deleteRemoteExitNode(
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

        if (!remoteExitNode.exitNodeId) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    `Remote exit node with ID ${remoteExitNodeId} does not have an exit node ID`
                )
            );
        }

        const [org] = await db.select().from(orgs).where(eq(orgs.orgId, orgId));

        if (!org) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Org with ID ${orgId} not found`
                )
            );
        }

        await db.transaction(async (trx) => {
            await trx
                .delete(exitNodeOrgs)
                .where(
                    and(
                        eq(exitNodeOrgs.orgId, orgId),
                        eq(exitNodeOrgs.exitNodeId, remoteExitNode.exitNodeId!)
                    )
                );

            // calculate if the user is in any other of the orgs before we count it as an remove to the billing org
            if (org.billingOrgId) {
                const otherBillingOrgs = await trx
                    .select()
                    .from(orgs)
                    .where(eq(orgs.billingOrgId, org.billingOrgId));

                const billingOrgIds = otherBillingOrgs.map((o) => o.orgId);

                const orgsInBillingDomainThatTheNodeIsStillIn = await trx
                    .select()
                    .from(exitNodeOrgs)
                    .where(
                        and(
                            eq(
                                exitNodeOrgs.exitNodeId,
                                remoteExitNode.exitNodeId!
                            ),
                            inArray(exitNodeOrgs.orgId, billingOrgIds)
                        )
                    );

                if (orgsInBillingDomainThatTheNodeIsStillIn.length === 0) {
                    await usageService.add(
                        orgId,
                        LimitId.REMOTE_EXIT_NODES,
                        -1,
                        trx
                    );
                }
            }
        });

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Remote exit node deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
