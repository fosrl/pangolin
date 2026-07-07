import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, orgs, primaryDb } from "@server/db";
import {
    roles,
    userInviteRoles,
    userInvites,
    userOrgs,
    users
} from "@server/db";
import { eq, and, inArray } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { checkValidInvite } from "@server/auth/checkValidInvite";
import { verifySession } from "@server/auth/sessions/verifySession";
import { usageService } from "@server/lib/billing/usageService";
import { LimitId } from "@server/lib/billing";
import { calculateUserClientsForOrgs } from "@server/lib/calculateUserClientsForOrgs";
import { build } from "@server/build";
import { assignUserToOrg } from "@server/lib/userOrg";
import { isOrgRebuildRateLimited } from "@server/lib/rebuildClientAssociations";

const acceptInviteBodySchema = z.strictObject({
    token: z.string(),
    inviteId: z.string()
});

export type AcceptInviteResponse = {
    accepted: boolean;
    orgId: string;
};

export async function acceptInvite(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = acceptInviteBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { token, inviteId } = parsedBody.data;

        const { error, existingInvite } = await checkValidInvite({
            token,
            inviteId
        });

        if (error) {
            return next(createHttpError(HttpCode.BAD_REQUEST, error));
        }

        if (!existingInvite) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invite does not exist")
            );
        }

        const existingUser = await db
            .select()
            .from(users)
            .where(eq(users.email, existingInvite.email))
            .limit(1);
        if (!existingUser.length) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "User does not exist. Please create an account first."
                )
            );
        }

        const { user, session } = await verifySession(req);

        // at this point we know the user exists
        if (!user) {
            return next(
                createHttpError(
                    HttpCode.UNAUTHORIZED,
                    "You must be logged in to accept an invite"
                )
            );
        }

        if (user && user.email !== existingInvite.email) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Invite is not for this user"
                )
            );
        }

        if (build == "saas") {
            const usage = await usageService.getUsage(
                existingInvite.orgId,
                LimitId.USERS
            );
            if (!usage) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        "No usage data found for this organization"
                    )
                );
            }
            const rejectUsers = await usageService.checkLimitSet(
                existingInvite.orgId,

                LimitId.USERS,
                {
                    ...usage,
                    instantaneousValue: (usage.instantaneousValue || 0) + 1
                } // We need to add one to know if we are violating the limit
            );
            if (rejectUsers) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "Can not accept because this org's user limit is exceeded. Please contact your administrator to upgrade their plan."
                    )
                );
            }
        }

        const [org] = await db
            .select()
            .from(orgs)
            .where(eq(orgs.orgId, existingInvite.orgId))
            .limit(1);

        if (!org) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Organization does not exist. Please contact an admin."
                )
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

        const inviteRoleRows = await db
            .select({ roleId: userInviteRoles.roleId })
            .from(userInviteRoles)
            .where(eq(userInviteRoles.inviteId, inviteId));

        const inviteRoleIds = [...new Set(inviteRoleRows.map((r) => r.roleId))];
        if (inviteRoleIds.length === 0) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "This invitation has no roles. Please contact an admin."
                )
            );
        }

        const existingRoles = await db
            .select()
            .from(roles)
            .where(
                and(
                    eq(roles.orgId, existingInvite.orgId),
                    inArray(roles.roleId, inviteRoleIds)
                )
            );

        if (existingRoles.length !== inviteRoleIds.length) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Role does not exist. Please contact an admin."
                )
            );
        }

        await db.transaction(async (trx) => {
            await assignUserToOrg(
                org,
                {
                    userId: existingUser[0].userId,
                    orgId: existingInvite.orgId
                },
                inviteRoleIds,
                trx
            );

            // delete the invite
            await trx
                .delete(userInvites)
                .where(eq(userInvites.inviteId, inviteId));

            logger.debug(
                `User ${existingUser[0].userId} accepted invite to org ${existingInvite.orgId}`
            );
        });

        calculateUserClientsForOrgs(existingUser[0].userId).catch((e) => {
            logger.error(
                `Failed to calculate user clients after accepting invite for user ${existingUser[0].userId}: ${e}`
            );
        });

        return response<AcceptInviteResponse>(res, {
            data: { accepted: true, orgId: existingInvite.orgId },
            success: true,
            error: false,
            message: "Invite accepted",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
