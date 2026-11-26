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
import { UserType } from "@server/types/UserTypes";

const acceptInviteBodySchema = z.strictObject({
    token: z.string(),
    inviteId: z.string()
});

/**
 * Why an invite was not accepted, for the cases the invite page handles by
 * sending the user somewhere (sign up, log in, switch account) or explaining
 * the problem. These are answered with HTTP 200 and `accepted: false` rather
 * than an error status: reverse proxies are often set up to replace 4xx bodies
 * with a generic error page, which used to hide the reason and made every new
 * invitee see "invite expired" (#2426). A bad token, a missing invite and
 * server faults are still errors.
 */
export type AcceptInviteStatus =
    | "accepted"
    | "user_does_not_exist"
    | "not_logged_in"
    | "wrong_user"
    | "oidc_not_allowed"
    | "user_limit_exceeded";

export type AcceptInviteResponse = {
    accepted: boolean;
    orgId: string;
    status: AcceptInviteStatus;
};

function inviteNotAccepted(
    res: Response,
    orgId: string,
    status: Exclude<AcceptInviteStatus, "accepted">,
    message: string
) {
    return response<AcceptInviteResponse>(res, {
        data: { accepted: false, orgId, status },
        success: true,
        error: false,
        message,
        status: HttpCode.OK
    });
}

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

        const [existingInternalUser] = await db
            .select()
            .from(users)
            .where(
                and(
                    eq(users.email, existingInvite.email),
                    eq(users.type, UserType.Internal)
                )
            )
            .limit(1);
        if (!existingInternalUser) {
            return inviteNotAccepted(
                res,
                existingInvite.orgId,
                "user_does_not_exist",
                "User does not exist. Please create an account first."
            );
        }

        const { user } = await verifySession(req);

        if (!user) {
            return inviteNotAccepted(
                res,
                existingInvite.orgId,
                "not_logged_in",
                "You must be logged in to accept an invite"
            );
        }

        if (user.email !== existingInvite.email) {
            return inviteNotAccepted(
                res,
                existingInvite.orgId,
                "wrong_user",
                "Invite is not for this user"
            );
        }

        if (user.type !== UserType.Internal) {
            return inviteNotAccepted(
                res,
                existingInvite.orgId,
                "oidc_not_allowed",
                "Invites can only be accepted by internal users."
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
                return inviteNotAccepted(
                    res,
                    existingInvite.orgId,
                    "user_limit_exceeded",
                    "Can not accept because this org's user limit is exceeded. Please contact your administrator to upgrade their plan."
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
                    userId: user.userId,
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
                `User ${user.userId} accepted invite to org ${existingInvite.orgId}`
            );
        });

        calculateUserClientsForOrgs(user.userId).catch((e) => {
            logger.error(
                `Failed to calculate user clients after accepting invite for user ${user.userId}: ${e}`
            );
        });

        return response<AcceptInviteResponse>(res, {
            data: {
                accepted: true,
                orgId: existingInvite.orgId,
                status: "accepted"
            },
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
