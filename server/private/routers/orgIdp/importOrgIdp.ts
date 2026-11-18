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
import { db } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { idp, idpOrg, orgs, roles, userOrgs } from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import { CreateOrgIdpResponse } from "@server/routers/orgIdp/types";
import { generateOidcRedirectUrl } from "@server/lib/idp/generateRedirectUrl";
import { checkOrgAccessPolicy } from "#private/lib/checkOrgAccessPolicy";
import { getUserOrgRoleIds } from "@server/lib/userOrgRoles";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty(),
    idpId: z.coerce.number<number>().int().positive()
});

const bodySchema = z.strictObject({
    sourceOrgId: z.string().nonempty()
});

async function userIsOrgAdmin(
    userId: string,
    orgId: string,
    session: Request["session"]
): Promise<boolean> {
    const [userOrgRow] = await db
        .select()
        .from(userOrgs)
        .where(and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, orgId)))
        .limit(1);

    if (!userOrgRow) {
        return false;
    }

    const policyCheck = await checkOrgAccessPolicy({
        orgId,
        userId,
        session
    });
    if (!policyCheck.allowed || policyCheck.error) {
        return false;
    }

    const roleIds = await getUserOrgRoleIds(userId, orgId);
    if (roleIds.length === 0) {
        return false;
    }

    const [adminRole] = await db
        .select()
        .from(roles)
        .where(and(inArray(roles.roleId, roleIds), eq(roles.isAdmin, true)))
        .limit(1);

    return !!adminRole;
}

export async function importOrgIdp(
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

        const { orgId: targetOrgId, idpId } = parsedParams.data;

        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { sourceOrgId } = parsedBody.data;

        if (sourceOrgId === targetOrgId) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Source and target organization must be different"
                )
            );
        }

        const userId = req.user!.userId;

        const sourceLinked = await db
            .select()
            .from(idpOrg)
            .where(and(eq(idpOrg.idpId, idpId), eq(idpOrg.orgId, sourceOrgId)))
            .limit(1);

        if (sourceLinked.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "IdP not found for the source organization"
                )
            );
        }

        const sourceAdmin = await userIsOrgAdmin(
            userId,
            sourceOrgId,
            req.session
        );
        if (!sourceAdmin) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "You must be an organization admin in the source organization where this IdP is linked"
                )
            );
        }

        const [targetOrg] = await db
            .select({ orgId: orgs.orgId })
            .from(orgs)
            .where(eq(orgs.orgId, targetOrgId))
            .limit(1);

        if (!targetOrg) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "Target organization not found"
                )
            );
        }

        const [existingIdp] = await db
            .select()
            .from(idp)
            .where(eq(idp.idpId, idpId))
            .limit(1);

        if (!existingIdp) {
            return next(createHttpError(HttpCode.NOT_FOUND, "IdP not found"));
        }

        const alreadyTarget = await db
            .select()
            .from(idpOrg)
            .where(and(eq(idpOrg.idpId, idpId), eq(idpOrg.orgId, targetOrgId)))
            .limit(1);

        if (alreadyTarget.length > 0) {
            return next(
                createHttpError(
                    HttpCode.CONFLICT,
                    "This IdP is already linked to the target organization"
                )
            );
        }

        await db.insert(idpOrg).values({
            idpId,
            orgId: targetOrgId,
            roleMapping: null,
            orgMapping: null,
            autoProvision: false
        });

        const redirectUrl = await generateOidcRedirectUrl(idpId, targetOrgId);

        return response<CreateOrgIdpResponse>(res, {
            data: {
                idpId,
                redirectUrl
            },
            success: true,
            error: false,
            message: "Org IdP imported successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
