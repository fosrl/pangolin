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
import { db, idpOrg, orgs, primaryDb, users, userOrgs } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { and, eq, sql } from "drizzle-orm";
import { removeUserFromOrg } from "@server/lib/userOrg";
import { calculateUserClientsForOrgs } from "@server/lib/calculateUserClientsForOrgs";
import { OpenAPITags, registry } from "@server/openApi";
import { isOrgRebuildRateLimited } from "@server/lib/rebuildClientAssociations";

const paramsSchema = z
    .object({
        orgId: z.string().nonempty(),
        idpId: z.coerce.number<number>().int().positive()
    })
    .strict();

export async function unassociateOrgIdp(
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

        const { orgId, idpId } = parsedParams.data;

        const [association] = await db
            .select()
            .from(idpOrg)
            .where(and(eq(idpOrg.idpId, idpId), eq(idpOrg.orgId, orgId)))
            .limit(1);

        if (!association) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `IdP with ID ${idpId} is not associated with organization ${orgId}`
                )
            );
        }

        const [{ count }] = await db
            .select({ count: sql<number>`count(*)` })
            .from(idpOrg)
            .where(eq(idpOrg.idpId, idpId));

        if (count <= 1) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "This is the last organization associated with this identity provider. Delete it instead."
                )
            );
        }

        const [org] = await db
            .select()
            .from(orgs)
            .where(eq(orgs.orgId, orgId))
            .limit(1);

        if (!org) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Organization not found")
            );
        }

        if (await isOrgRebuildRateLimited(org.orgId)) {
            return next(
                createHttpError(
                    HttpCode.TOO_MANY_REQUESTS,
                    "Too many concurrent rebuild operations for this organization. Please retry after a moment."
                )
            );
        }

        const orgUsersFromIdp = await db
            .select({
                userId: userOrgs.userId,
                isOwner: userOrgs.isOwner
            })
            .from(userOrgs)
            .innerJoin(users, eq(users.userId, userOrgs.userId))
            .where(and(eq(userOrgs.orgId, orgId), eq(users.idpId, idpId)));

        if (orgUsersFromIdp.some((u) => u.isOwner)) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Cannot unassociate identity provider while an organization owner uses it"
                )
            );
        }

        const userIdsToRemove = orgUsersFromIdp.map((u) => u.userId);

        await db.transaction(async (trx) => {
            for (const userId of userIdsToRemove) {
                await removeUserFromOrg(org, userId, trx);
            }

            await trx
                .delete(idpOrg)
                .where(and(eq(idpOrg.idpId, idpId), eq(idpOrg.orgId, orgId)));
        });

        for (const userId of userIdsToRemove) {
            calculateUserClientsForOrgs(userId).catch((e) => {
                logger.error(
                    `Failed to calculate user clients after removing user ${userId} from org ${orgId} during IdP unassociation: ${e}`
                );
            });
        }

        return response<null>(res, {
            data: null,
            success: true,
            error: false,
            message: "Org IdP unassociated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
