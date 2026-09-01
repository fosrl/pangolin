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

import { db, userOrgRoles, users } from "@server/db";
import logger from "@server/logger";
import type {
    EmailAlertAction,
    TestAlertContext,
    WebhookAlertConfig
} from "@server/routers/alertRule/types";
import { eq, inArray } from "drizzle-orm";
import { sendAlertEmail } from "./sendAlertEmail";
import { sendAlertWebhook } from "./sendAlertWebhook";

export async function processTestAlerts(context: TestAlertContext) {
    // Process email actions
    const emailActions = context.actions.filter(
        (action) => action.type === "email"
    );
    for (const action of emailActions) {
        try {
            const recipients = await resolveEmailRecipients(action);
            if (recipients.length > 0) {
                await sendAlertEmail(recipients, {
                    ...context,
                    isTest: true
                });
            }
        } catch (err) {
            logger.error(`processTestAlerts: failed to send alert email`, err);
        }
    }

    // Process webhook actions
    const webhookActions = context.actions.filter(
        (action) => action.type === "webhook"
    );

    for (const action of webhookActions) {
        try {
            let webhookConfig: WebhookAlertConfig = { authType: "none" };

            if (action.config) {
                try {
                    webhookConfig = JSON.parse(
                        action.config
                    ) as WebhookAlertConfig;
                } catch (err) {
                    logger.error(
                        `processTestAlerts: failed to decrypt webhook`,
                        err
                    );
                    continue;
                }
            }

            await sendAlertWebhook(action.webhookUrl, webhookConfig, {
                ...context,
                isTest: true
            });
        } catch (err) {
            logger.error(
                `processTestAlerts: failed to send alert webhook `,
                err
            );
        }
    }
}

/**
 * Resolves all email addresses for a given `emailActionId`.
 *
 * Recipients may be:
 * - Direct users (by `userId`)
 * - All users in a role (by `roleId`, resolved via `userOrgRoles`)
 * - Direct external email addresses
 */
async function resolveEmailRecipients(
    action: EmailAlertAction
): Promise<string[]> {
    const emailList: string[] = [];

    emailList.push(...(action.emails ?? []));

    if (action.userIds && action.userIds?.length > 0) {
        const userList = await db
            .select({ email: users.email })
            .from(users)
            .where(inArray(users.userId, action.userIds));

        emailList.push(
            ...userList.filter((u) => u.email !== null).map((u) => u.email!)
        );
    }
    if (action.roleIds && action.roleIds?.length > 0) {
        const userList = await db
            .select({ email: users.email })
            .from(userOrgRoles)
            .innerJoin(users, eq(userOrgRoles.userId, users.userId))
            .where(inArray(userOrgRoles.roleId, action.roleIds.map(Number)));

        emailList.push(
            ...userList.filter((u) => u.email !== null).map((u) => u.email!)
        );
    }

    return [...new Set(emailList)];
}
