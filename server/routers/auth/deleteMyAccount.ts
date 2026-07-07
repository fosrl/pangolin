import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, orgs, userOrgs, users, primaryDb } from "@server/db";
import { eq, and, inArray, not } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { verifySession } from "@server/auth/sessions/verifySession";
import {
    invalidateSession,
    createBlankSessionTokenCookie
} from "@server/auth/sessions/app";
import { verifyPassword } from "@server/auth/password";
import { verifyTotpCode } from "@server/auth/totp";
import { calculateUserClientsForOrgs } from "@server/lib/calculateUserClientsForOrgs";
import { build } from "@server/build";
import { getOrgTierData } from "#dynamic/lib/billing";
import { deleteOrgById, sendTerminationMessages } from "@server/lib/deleteOrg";
import { UserType } from "@server/types/UserTypes";
import { usageService } from "@server/lib/billing/usageService";
import { LimitId } from "@server/lib/billing";

const deleteMyAccountBody = z.strictObject({
    password: z.string().optional(),
    code: z.string().optional()
});

export type DeleteMyAccountPreviewResponse = {
    preview: true;
    orgs: { orgId: string; name: string }[];
    twoFactorEnabled: boolean;
};

export type DeleteMyAccountCodeRequestedResponse = {
    codeRequested: true;
};

export type DeleteMyAccountSuccessResponse = {
    success: true;
};

export async function deleteMyAccount(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const { user, session } = await verifySession(req);
        if (!user || !session) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "Not authenticated")
            );
        }

        if (user.serverAdmin) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Server admins cannot delete their account this way"
                )
            );
        }

        if (user.type !== UserType.Internal) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Account deletion with password is only supported for internal users"
                )
            );
        }

        const parsed = deleteMyAccountBody.safeParse(req.body ?? {});
        if (!parsed.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsed.error).toString()
                )
            );
        }
        const { password, code } = parsed.data;

        const userId = user.userId;

        const ownedOrgsRows = await db
            .select({
                orgId: userOrgs.orgId,
                isOwner: userOrgs.isOwner,
                isBillingOrg: orgs.isBillingOrg
            })
            .from(userOrgs)
            .innerJoin(orgs, eq(userOrgs.orgId, orgs.orgId))
            .where(
                and(eq(userOrgs.userId, userId), eq(userOrgs.isOwner, true))
            );

        const ownedOrgIds = ownedOrgsRows.map((r) => r.orgId);

        if (build === "saas" && ownedOrgIds.length > 0) {
            const primaryOrgId = ownedOrgsRows.find(
                (r) => r.isBillingOrg && r.isOwner
            )?.orgId;
            if (primaryOrgId) {
                const { tier, active, isTrial } =
                    await getOrgTierData(primaryOrgId);
                if (active && tier && !isTrial) {
                    return next(
                        createHttpError(
                            HttpCode.BAD_REQUEST,
                            "You must cancel your subscription before deleting your account"
                        )
                    );
                }
            }
        }

        if (!password) {
            const orgsWithNames =
                ownedOrgIds.length > 0
                    ? await db
                          .select({
                              orgId: orgs.orgId,
                              name: orgs.name
                          })
                          .from(orgs)
                          .where(inArray(orgs.orgId, ownedOrgIds))
                    : [];
            return response<DeleteMyAccountPreviewResponse>(res, {
                data: {
                    preview: true,
                    orgs: orgsWithNames.map((o) => ({
                        orgId: o.orgId,
                        name: o.name ?? ""
                    })),
                    twoFactorEnabled: user.twoFactorEnabled ?? false
                },
                success: true,
                error: false,
                message: "Preview",
                status: HttpCode.OK
            });
        }

        const validPassword = await verifyPassword(
            password,
            user.passwordHash!
        );
        if (!validPassword) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "Invalid password")
            );
        }

        if (user.twoFactorEnabled) {
            if (!code) {
                return response<DeleteMyAccountCodeRequestedResponse>(res, {
                    data: { codeRequested: true },
                    success: true,
                    error: false,
                    message: "Two-factor code required",
                    status: HttpCode.ACCEPTED
                });
            }
            const validOTP = await verifyTotpCode(
                code,
                user.twoFactorSecret!,
                user.userId
            );
            if (!validOTP) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "The two-factor code you entered is incorrect"
                    )
                );
            }
        }

        const allDeletedNewtIds: string[] = [];
        const allOlmsToTerminate: string[] = [];

        for (const row of ownedOrgsRows) {
            try {
                const result = await deleteOrgById(row.orgId);
                allDeletedNewtIds.push(...result.deletedNewtIds);
                allOlmsToTerminate.push(...result.olmsToTerminate);
            } catch (err) {
                logger.error(
                    `Failed to delete org ${row.orgId} during account deletion`,
                    err
                );
                return next(
                    createHttpError(
                        HttpCode.INTERNAL_SERVER_ERROR,
                        "Failed to delete organization"
                    )
                );
            }
        }

        sendTerminationMessages({
            deletedNewtIds: allDeletedNewtIds,
            olmsToTerminate: allOlmsToTerminate
        });

        const otherOrgsTheUserWasIn = await db
            .select()
            .from(userOrgs)
            .where(
                and(
                    eq(userOrgs.userId, userId),
                    not(inArray(userOrgs.orgId, ownedOrgIds))
                )
            );

        await db.transaction(async (trx) => {
            await trx.delete(users).where(eq(users.userId, userId));
            // loop through the other orgs and decrement the count
            for (const userOrg of otherOrgsTheUserWasIn) {
                await usageService.add(userOrg.orgId, LimitId.USERS, -1, trx);
            }
        });

        calculateUserClientsForOrgs(userId).catch((e) => {
            logger.error(
                `Failed to calculate user clients after deleting account for user ${userId}: ${e}`
            );
        });

        try {
            await invalidateSession(session.sessionId);
        } catch (error) {
            logger.error(
                "Failed to invalidate session after account deletion",
                error
            );
        }

        const isSecure = req.protocol === "https";
        res.setHeader("Set-Cookie", createBlankSessionTokenCookie(isSecure));

        return response<DeleteMyAccountSuccessResponse>(res, {
            data: { success: true },
            success: true,
            error: false,
            message: "Account deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
