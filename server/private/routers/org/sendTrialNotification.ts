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
import { userOrgs, userOrgRoles, users, roles, orgs } from "@server/db";
import { eq, and, or } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { sendEmail } from "@server/emails";
import NotifyTrialExpiring from "@server/emails/templates/NotifyTrialExpiring";
import config from "@server/lib/config";
import { handleSubscriptionLifesycle } from "../billing/subscriptionLifecycle";

const sendTrialNotificationParamsSchema = z.object({
    orgId: z.string()
});

const sendTrialNotificationBodySchema = z.object({
    notificationType: z.enum([
        "trial_ending_5d",
        "trial_ending_24h",
        "trial_ended"
    ]),
    orgName: z.string(),
    trialEndsAt: z.number(),
    billingLink: z.string().optional()
});

export type SendTrialNotificationResponse = {
    success: boolean;
    emailsSent: number;
    adminEmails: string[];
};

async function getOrgAdmins(orgId: string) {
    const admins = await db
        .select({
            userId: users.userId,
            email: users.email,
            name: users.name,
            isOwner: userOrgs.isOwner,
            roleName: roles.name,
            isAdminRole: roles.isAdmin
        })
        .from(userOrgs)
        .innerJoin(users, eq(userOrgs.userId, users.userId))
        .leftJoin(
            userOrgRoles,
            and(
                eq(userOrgs.userId, userOrgRoles.userId),
                eq(userOrgs.orgId, userOrgRoles.orgId)
            )
        )
        .leftJoin(roles, eq(userOrgRoles.roleId, roles.roleId))
        .where(
            and(
                eq(userOrgs.orgId, orgId),
                or(eq(userOrgs.isOwner, true), eq(roles.isAdmin, true))
            )
        );

    const byUserId = new Map(admins.map((a) => [a.userId, a]));
    const orgAdmins = Array.from(byUserId.values()).filter(
        (admin) => admin.email && admin.email.length > 0
    );

    return orgAdmins;
}

export async function sendTrialNotification(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = sendTrialNotificationParamsSchema.safeParse(
            req.params
        );
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const parsedBody = sendTrialNotificationBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { orgId } = parsedParams.data;
        const {
            notificationType,
            orgName,
            trialEndsAt,
            billingLink: bodyBillingLink
        } = parsedBody.data;

        // Verify organization exists
        const org = await db
            .select()
            .from(orgs)
            .where(eq(orgs.orgId, orgId))
            .limit(1);

        if (org.length === 0) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Organization not found")
            );
        }

        // Get all admin users for this organization
        const orgAdmins = await getOrgAdmins(orgId);

        if (orgAdmins.length === 0) {
            logger.warn(`No admin users found for organization ${orgId}`);
            return response<SendTrialNotificationResponse>(res, {
                data: {
                    success: true,
                    emailsSent: 0,
                    adminEmails: []
                },
                success: true,
                error: false,
                message: "No admin users found to notify",
                status: HttpCode.OK
            });
        }

        const billingLink =
            bodyBillingLink ??
            `${config.getRawConfig().app.dashboard_url}/${orgId}/settings/billing`;

        const trialEndsAtFormatted = new Date(
            trialEndsAt * 1000
        ).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric"
        });

        let daysRemaining: number | null;
        let subject: string;
        let resetLimits = false;

        if (notificationType === "trial_ending_5d") {
            daysRemaining = 5;
            subject = "Your trial ends in 5 days";
        } else if (notificationType === "trial_ending_24h") {
            daysRemaining = 1;
            subject = "Your trial ends tomorrow";
        } else {
            daysRemaining = null;
            subject = "Your trial has ended";
            resetLimits = true;
        }

        let emailsSent = 0;
        const adminEmails: string[] = [];

        for (const admin of orgAdmins) {
            if (!admin.email) continue;

            try {
                const template = NotifyTrialExpiring({
                    email: admin.email,
                    orgName,
                    trialEndsAt: trialEndsAtFormatted,
                    daysRemaining,
                    billingLink
                });

                await sendEmail(template, {
                    to: admin.email,
                    from: config.getNoReplyEmail(),
                    subject
                });

                emailsSent++;
                adminEmails.push(admin.email);

                logger.info(
                    `Trial notification sent to admin ${admin.email} for org ${orgId}`
                );
            } catch (emailError) {
                logger.error(
                    `Failed to send trial notification to ${admin.email}:`,
                    emailError
                );
                // Continue with other admins even if one fails
            }
        }

        if (resetLimits) {
            // this will only fire if they have not upgraded yet because when upgrading we delete the trial
            await handleSubscriptionLifesycle(orgId, "canceled");
            logger.debug(
                `Trial ended for org ${orgId}, limits reset to free tier`
            );
        }

        return response<SendTrialNotificationResponse>(res, {
            data: {
                success: true,
                emailsSent,
                adminEmails
            },
            success: true,
            error: false,
            message: `Trial notifications sent to ${emailsSent} administrators`,
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error("Error sending trial notifications:", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to send trial notifications"
            )
        );
    }
}
