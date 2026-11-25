import { Request, Response, NextFunction } from "express";
import { db } from "@server/db";
import { roles, apiKeyOrg } from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import logger from "@server/logger";
import { ownApiKeyOrg } from "@server/lib/requestAuthState";

export async function verifyApiKeyRoleAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const apiKey = req.apiKey;
        const singleRoleId = parseInt(
            req.params.roleId || req.body.roleId || req.query.roleId
        );

        if (!apiKey) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "Key not authenticated")
            );
        }

        let allRoleIds: number[] = [];
        if (!isNaN(singleRoleId)) {
            // If roleId is provided in URL params, query params, or body (single), use it exclusively
            allRoleIds = [singleRoleId];
        } else if (req.body?.roleIds) {
            // Only use body.roleIds if no single roleId was provided
            allRoleIds = req.body.roleIds;
        }

        if (allRoleIds.length === 0) {
            return next();
        }

        const rolesData = await db
            .select()
            .from(roles)
            .where(inArray(roles.roleId, allRoleIds));

        if (rolesData.length !== allRoleIds.length) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "One or more roles not found"
                )
            );
        }

        if (apiKey.isRoot) {
            // Root keys can access any key in any org
            return next();
        }

        const orgIds = new Set(rolesData.map((role) => role.orgId));

        for (const role of rolesData) {
            const apiKeyOrgAccess = await db
                .select()
                .from(apiKeyOrg)
                .where(
                    and(
                        eq(apiKeyOrg.apiKeyId, apiKey.apiKeyId),
                        eq(apiKeyOrg.orgId, role.orgId!)
                    )
                )
                .limit(1);

            if (apiKeyOrgAccess.length === 0) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        `Key does not have access to organization for role ID ${role.roleId}`
                    )
                );
            }
        }

        if (orgIds.size > 1) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "Roles must belong to the same organization"
                )
            );
        }

        const orgId = orgIds.values().next().value;

        if (!orgId) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Roles do not have an organization ID"
                )
            );
        }

        if (!ownApiKeyOrg(req)) {
            // Retrieve the API key's organization link if not already set
            const apiKeyOrgRes = await db
                .select()
                .from(apiKeyOrg)
                .where(
                    and(
                        eq(apiKeyOrg.apiKeyId, apiKey.apiKeyId),
                        eq(apiKeyOrg.orgId, orgId)
                    )
                )
                .limit(1);

            if (apiKeyOrgRes.length === 0) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "Key does not have access to this organization"
                    )
                );
            }

            req.apiKeyOrg = apiKeyOrgRes[0];
        }

        if (!req.apiKeyOrg || ownApiKeyOrg(req)?.orgId !== orgId) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "Key does not have access to this organization"
                )
            );
        }

        return next();
    } catch (error) {
        logger.error("Error verifying role access:", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error verifying role access"
            )
        );
    }
}
