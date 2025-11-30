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

import { NextFunction, Request, Response } from "express";
import { db, exitNodes, exitNodeOrgs, ExitNode, ExitNodeOrg } from "@server/db";
import HttpCode from "@server/types/HttpCode";
import { z } from "zod";
import { remoteExitNodes } from "@server/db";
import createHttpError from "http-errors";
import response from "@server/lib/response";
import { SqliteError } from "better-sqlite3";
import moment from "moment";
import { generateSessionToken } from "@server/auth/sessions/app";
import { createRemoteExitNodeSession } from "#private/auth/sessions/remoteExitNode";
import { fromError } from "zod-validation-error";
import { hashPassword, verifyPassword } from "@server/auth/password";
import logger from "@server/logger";
import { and, eq } from "drizzle-orm";
import { getNextAvailableSubnet } from "@server/lib/exitNodes";
import { usageService } from "@server/lib/billing/usageService";
import { FeatureId } from "@server/lib/billing";
import { CreateRemoteExitNodeResponse } from "@server/routers/remoteExitNode/types";

export const paramsSchema = z.object({
    orgId: z.string()
});

const bodySchema = z
    .object({
        remoteExitNodeId: z.string().length(15),
        secret: z.string().length(48)
    })
    .strict();

export type CreateRemoteExitNodeBody = z.infer<typeof bodySchema>;

export async function createRemoteExitNode(
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

        const { orgId } = parsedParams.data;

        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { remoteExitNodeId, secret } = parsedBody.data;

        if (req.user && !req.userOrgRoleId) {
            return next(
                createHttpError(HttpCode.FORBIDDEN, "User does not have a role")
            );
        }

        const usage = await usageService.getUsage(
            orgId,
            FeatureId.REMOTE_EXIT_NODES
        );
        if (usage) {
            const rejectRemoteExitNodes = await usageService.checkLimitSet(
                orgId,
                false,
                FeatureId.REMOTE_EXIT_NODES,
                {
                    ...usage,
                    instantaneousValue: (usage.instantaneousValue || 0) + 1
                } // We need to add one to know if we are violating the limit
            );

            if (rejectRemoteExitNodes) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "Remote exit node limit exceeded. Please upgrade your plan or contact us at support@pangolin.net"
                    )
                );
            }
        }

        const secretHash = await hashPassword(secret);
        // const address = await getNextAvailableSubnet();
        const address = "100.89.140.1/24"; // FOR NOW LETS HARDCODE THESE ADDRESSES

        const [existingRemoteExitNode] = await db
            .select()
            .from(remoteExitNodes)
            .where(eq(remoteExitNodes.remoteExitNodeId, remoteExitNodeId));

        if (existingRemoteExitNode) {
            // validate the secret

            const validSecret = await verifyPassword(
                secret,
                existingRemoteExitNode.secretHash
            );
            if (!validSecret) {
                logger.info(
                    `Failed secret validation for remote exit node: ${remoteExitNodeId}`
                );
                return next(
                    createHttpError(
                        HttpCode.UNAUTHORIZED,
                        "Invalid secret for remote exit node"
                    )
                );
            }
        }

        let existingExitNode: ExitNode | null = null;
        if (existingRemoteExitNode?.exitNodeId) {
            const [res] = await db
                .select()
                .from(exitNodes)
                .where(
                    eq(exitNodes.exitNodeId, existingRemoteExitNode.exitNodeId)
                );
            existingExitNode = res;
        }

        let existingExitNodeOrg: ExitNodeOrg | null = null;
        if (existingRemoteExitNode?.exitNodeId) {
            const [res] = await db
                .select()
                .from(exitNodeOrgs)
                .where(
                    and(
                        eq(
                            exitNodeOrgs.exitNodeId,
                            existingRemoteExitNode.exitNodeId
                        ),
                        eq(exitNodeOrgs.orgId, orgId)
                    )
                );
            existingExitNodeOrg = res;
        }

        if (existingExitNodeOrg) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Remote exit node already exists in this organization"
                )
            );
        }

        let numExitNodeOrgs: ExitNodeOrg[] | undefined;

        await db.transaction(async (trx) => {
            if (!existingExitNode) {
                const [res] = await trx
                    .insert(exitNodes)
                    .values({
                        name: remoteExitNodeId,
                        address,
                        endpoint: "",
                        publicKey: "",
                        listenPort: 0,
                        online: false,
                        type: "remoteExitNode"
                    })
                    .returning();
                existingExitNode = res;
            }

            if (!existingRemoteExitNode) {
                await trx.insert(remoteExitNodes).values({
                    remoteExitNodeId: remoteExitNodeId,
                    secretHash,
                    dateCreated: moment().toISOString(),
                    exitNodeId: existingExitNode.exitNodeId
                });
            } else {
                // update the existing remote exit node
                await trx
                    .update(remoteExitNodes)
                    .set({
                        exitNodeId: existingExitNode.exitNodeId
                    })
                    .where(
                        eq(
                            remoteExitNodes.remoteExitNodeId,
                            existingRemoteExitNode.remoteExitNodeId
                        )
                    );
            }

            if (!existingExitNodeOrg) {
                await trx.insert(exitNodeOrgs).values({
                    exitNodeId: existingExitNode.exitNodeId,
                    orgId: orgId
                });
            }

            numExitNodeOrgs = await trx
                .select()
                .from(exitNodeOrgs)
                .where(eq(exitNodeOrgs.orgId, orgId));
        });

        if (numExitNodeOrgs) {
            await usageService.updateDaily(
                orgId,
                FeatureId.REMOTE_EXIT_NODES,
                numExitNodeOrgs.length
            );
        }

        const token = generateSessionToken();
        await createRemoteExitNodeSession(token, remoteExitNodeId);

        return response<CreateRemoteExitNodeResponse>(res, {
            data: {
                remoteExitNodeId,
                secret,
                token
            },
            success: true,
            error: false,
            message: "RemoteExitNode created successfully",
            status: HttpCode.OK
        });
    } catch (e) {
        if (e instanceof SqliteError && e.code === "SQLITE_CONSTRAINT_UNIQUE") {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "A remote exit node with that ID already exists"
                )
            );
        } else {
            logger.error("Failed to create remoteExitNode", e);
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Failed to create remoteExitNode"
                )
            );
        }
    }
}
