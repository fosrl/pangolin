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
import { userOrgs, db, idp, idpOrg } from "@server/db";
import { and, eq } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { getUserOrgRoleIds } from "@server/lib/userOrgRoles";
import { getFirstString } from "@server/lib/requestParams";

export async function verifyIdpAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const userId = req.user!.userId;
        const idpIdRaw =
            getFirstString(req.params.idpId) ||
            getFirstString(req.body?.idpId) ||
            getFirstString(req.query?.idpId);
        const idpId = Number.parseInt(idpIdRaw ?? "", 10);
        const orgId = getFirstString(req.params.orgId);

        if (!userId) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
            );
        }

        if (!orgId) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid organization ID")
            );
        }

        if (Number.isNaN(idpId)) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid key ID")
            );
        }

        const [idpRes] = await db
            .select()
            .from(idp)
            .innerJoin(idpOrg, eq(idp.idpId, idpOrg.idpId))
            .where(and(eq(idp.idpId, idpId), eq(idpOrg.orgId, orgId)))
            .limit(1);

        if (!idpRes || !idpRes.idp || !idpRes.idpOrg) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `IdP with ID ${idpId} not found for organization ${orgId}`
                )
            );
        }

        if (!req.userOrg) {
            const userOrgRole = await db
                .select()
                .from(userOrgs)
                .where(
                    and(
                        eq(userOrgs.userId, userId),
                        eq(userOrgs.orgId, idpRes.idpOrg.orgId)
                    )
                )
                .limit(1);
            req.userOrg = userOrgRole[0];
        }

        if (!req.userOrg) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not have access to this organization"
                )
            );
        }

        req.userOrgRoleIds = await getUserOrgRoleIds(
            req.userOrg.userId,
            idpRes.idpOrg.orgId
        );

        return next();
    } catch (error) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error verifying idp access"
            )
        );
    }
}
