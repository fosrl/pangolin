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
import { db, exitNodeOrgs, exitNodes } from "@server/db";
import { remoteExitNodes } from "@server/db";
import { eq, and, count } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { ListRemoteExitNodesResponse } from "@server/routers/remoteExitNode/types";
import { regionalCache as cache } from "#private/lib/cache";
import semver from "semver";

let stalePangolinNodeVersion: string | null = null;

async function getLatestPangolinNodeVersion(): Promise<string | null> {
    try {
        const cachedVersion = await cache.get<string>(
            "cache:latestPangolinNodeVersion"
        );
        if (cachedVersion) {
            return cachedVersion;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1500);

        const res = await fetch(
            "https://api.github.com/repos/fosrl/pangolin-node/tags",
            { signal: controller.signal }
        );

        clearTimeout(timeoutId);

        if (!res.ok) {
            logger.warn(
                `Failed to fetch latest pangolin-node version from GitHub: ${res.status} ${res.statusText}`
            );
            return stalePangolinNodeVersion;
        }

        let tags = await res.json();
        if (!Array.isArray(tags) || tags.length === 0) {
            logger.warn("No tags found for pangolin-node repository");
            return stalePangolinNodeVersion;
        }

        tags = tags.filter((tag: any) => !tag.name.includes("rc"));
        tags.sort((a: any, b: any) => {
            const va = semver.coerce(a.name);
            const vb = semver.coerce(b.name);
            if (!va && !vb) return 0;
            if (!va) return 1;
            if (!vb) return -1;
            return semver.rcompare(va, vb);
        });

        const seen = new Set<string>();
        tags = tags.filter((tag: any) => {
            const normalised = semver.coerce(tag.name)?.version;
            if (!normalised || seen.has(normalised)) return false;
            seen.add(normalised);
            return true;
        });

        if (tags.length === 0) {
            logger.warn(
                "No valid semver tags found for pangolin-node repository"
            );
            return stalePangolinNodeVersion;
        }

        const latestVersion = tags[0].name;
        stalePangolinNodeVersion = latestVersion;
        await cache.set("cache:latestPangolinNodeVersion", latestVersion, 3600);

        return latestVersion;
    } catch (error: any) {
        if (error.name === "AbortError") {
            logger.warn(
                "Request to fetch latest pangolin-node version timed out (1.5s)"
            );
        } else if (error.cause?.code === "UND_ERR_CONNECT_TIMEOUT") {
            logger.warn(
                "Connection timeout while fetching latest pangolin-node version"
            );
        } else {
            logger.warn(
                "Error fetching latest pangolin-node version:",
                error.message || error
            );
        }
        return stalePangolinNodeVersion;
    }
}

const listRemoteExitNodesParamsSchema = z.strictObject({
    orgId: z.string()
});

const listRemoteExitNodesSchema = z.object({
    limit: z
        .string()
        .optional()
        .default("1000")
        .transform(Number)
        .pipe(z.int().positive()),
    offset: z
        .string()
        .optional()
        .default("0")
        .transform(Number)
        .pipe(z.int().nonnegative())
});

export function queryRemoteExitNodes(orgId: string) {
    return db
        .select({
            remoteExitNodeId: remoteExitNodes.remoteExitNodeId,
            dateCreated: remoteExitNodes.dateCreated,
            version: remoteExitNodes.version,
            exitNodeId: remoteExitNodes.exitNodeId,
            name: exitNodes.name,
            address: exitNodes.address,
            endpoint: exitNodes.endpoint,
            online: exitNodes.online,
            type: exitNodes.type
        })
        .from(exitNodeOrgs)
        .where(eq(exitNodeOrgs.orgId, orgId))
        .innerJoin(exitNodes, eq(exitNodes.exitNodeId, exitNodeOrgs.exitNodeId))
        .innerJoin(
            remoteExitNodes,
            eq(remoteExitNodes.exitNodeId, exitNodeOrgs.exitNodeId)
        );
}

export async function listRemoteExitNodes(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = listRemoteExitNodesSchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error)
                )
            );
        }
        const { limit, offset } = parsedQuery.data;

        const parsedParams = listRemoteExitNodesParamsSchema.safeParse(
            req.params
        );
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error)
                )
            );
        }
        const { orgId } = parsedParams.data;

        if (req.user && orgId && orgId !== req.userOrgId) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not have access to this organization"
                )
            );
        }

        const baseQuery = queryRemoteExitNodes(orgId);

        const countQuery = db
            .select({ count: count() })
            .from(remoteExitNodes)
            .innerJoin(
                exitNodes,
                eq(exitNodes.exitNodeId, remoteExitNodes.exitNodeId)
            )
            .where(eq(exitNodes.type, "remoteExitNode"));

        const remoteExitNodesList = await baseQuery.limit(limit).offset(offset);
        const totalCountResult = await countQuery;
        const totalCount = totalCountResult[0].count;

        const latestPangolinNodeVersionPromise = getLatestPangolinNodeVersion();

        const nodesWithUpdates = remoteExitNodesList.map((node) => ({
            ...node,
            updateAvailable: false
        }));

        try {
            const latestPangolinNodeVersion =
                await latestPangolinNodeVersionPromise;

            if (latestPangolinNodeVersion) {
                nodesWithUpdates.forEach((node) => {
                    if (node.version) {
                        try {
                            node.updateAvailable = semver.lt(
                                node.version,
                                latestPangolinNodeVersion
                            );
                        } catch {
                            node.updateAvailable = false;
                        }
                    }
                });
            }
        } catch (error) {
            logger.warn(
                "Failed to check for pangolin-node updates, continuing without update info:",
                error
            );
        }

        return response<ListRemoteExitNodesResponse>(res, {
            data: {
                remoteExitNodes: nodesWithUpdates,
                pagination: {
                    total: totalCount,
                    limit,
                    offset
                }
            },
            success: true,
            error: false,
            message: "Remote exit nodes retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
