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

import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@server/db";
import {
    alertRules,
    alertSites,
    alertHealthChecks,
    alertResources,
    alertEmailActions,
    alertEmailRecipients,
    alertWebhookActions,
    userOrgRoles,
    users
} from "@server/db";
import config from "@server/lib/config";
import { decrypt } from "@server/lib/crypto";
import logger from "@server/logger";
import { sendAlertWebhook } from "./sendAlertWebhook";
import { sendAlertEmail } from "./sendAlertEmail";
import {
    getAlertRuleIdsForLabels,
    getAlertSourceLabelIds
} from "./sourceLabels";
import {
    AlertContext,
    WebhookAlertConfig
} from "@server/routers/alertRule/types";

/**
 * Core alert processing pipeline.
 *
 * Given an `AlertContext`, this function:
 * 1. Finds all enabled `alertRules` whose `eventType` matches and that
 *    target the event's source, either because the rule matches all
 *    sources of that kind, lists the source explicitly in the `alertSites` /
 *    `alertHealthChecks` / `alertResources` junction tables, or lists a
 *    label (in `alertLabels`) that is attached to the source.
 * 2. Applies per-rule cooldown gating.
 * 3. Dispatches emails and webhook POSTs for every attached action.
 * 4. Updates `lastTriggeredAt` and `lastSentAt` timestamps.
 */
export async function processAlerts(context: AlertContext): Promise<void> {
    const now = Date.now();

    // ------------------------------------------------------------------
    // 1. Find matching alert rules
    // ------------------------------------------------------------------
    // Rules with allSites / allHealthChecks / allResources set to true match
    // ANY event of that type. Rules without these flags set match only the
    // specific IDs listed in the junction tables, or sources carrying one of
    // the labels listed in `alertLabels`.
    const sourceLabelIds = await getAlertSourceLabelIds({
        siteId: context.siteId,
        resourceId: context.resourceId,
        healthCheckId: context.healthCheckId
    });
    const labelRuleIds = await getAlertRuleIdsForLabels(sourceLabelIds);
    const labelMatch =
        labelRuleIds.length > 0
            ? inArray(alertRules.alertRuleId, labelRuleIds)
            : undefined;

    const baseConditions = and(
        eq(alertRules.orgId, context.orgId),
        eq(alertRules.eventType, context.eventType),
        eq(alertRules.enabled, true)
    );

    let rules: (typeof alertRules.$inferSelect)[];

    if (context.siteId != null) {
        const rows = await db
            .select()
            .from(alertRules)
            .leftJoin(
                alertSites,
                eq(alertSites.alertRuleId, alertRules.alertRuleId)
            )
            .where(
                and(
                    baseConditions,
                    or(
                        eq(alertRules.allSites, true),
                        eq(alertSites.siteId, context.siteId),
                        labelMatch
                    )
                )
            );
        // Deduplicate in case a rule matched on multiple junction rows
        const seen = new Set<number>();
        rules = rows
            .map((r) => r.alertRules)
            .filter((r) => {
                if (seen.has(r.alertRuleId)) return false;
                seen.add(r.alertRuleId);
                return true;
            });
    } else if (context.healthCheckId != null) {
        const rows = await db
            .select()
            .from(alertRules)
            .leftJoin(
                alertHealthChecks,
                eq(alertHealthChecks.alertRuleId, alertRules.alertRuleId)
            )
            .where(
                and(
                    baseConditions,
                    or(
                        eq(alertRules.allHealthChecks, true),
                        eq(
                            alertHealthChecks.healthCheckId,
                            context.healthCheckId
                        ),
                        labelMatch
                    )
                )
            );
        const seen = new Set<number>();
        rules = rows
            .map((r) => r.alertRules)
            .filter((r) => {
                if (seen.has(r.alertRuleId)) return false;
                seen.add(r.alertRuleId);
                return true;
            });
    } else if (context.resourceId != null) {
        const rows = await db
            .select()
            .from(alertRules)
            .leftJoin(
                alertResources,
                eq(alertResources.alertRuleId, alertRules.alertRuleId)
            )
            .where(
                and(
                    baseConditions,
                    or(
                        eq(alertRules.allResources, true),
                        eq(alertResources.resourceId, context.resourceId),
                        labelMatch
                    )
                )
            );
        const seen = new Set<number>();
        rules = rows
            .map((r) => r.alertRules)
            .filter((r) => {
                if (seen.has(r.alertRuleId)) return false;
                seen.add(r.alertRuleId);
                return true;
            });
    } else {
        rules = [];
    }

    if (rules.length === 0) {
        logger.debug(
            `processAlerts: no matching rules for event "${context.eventType}" in org "${context.orgId}"`
        );
        return;
    }

    for (const rule of rules) {
        try {
            await processRule(rule, context, now);
        } catch (err) {
            logger.error(
                `processAlerts: error processing rule ${rule.alertRuleId} for event "${context.eventType}"`,
                err
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Per-rule processing
// ---------------------------------------------------------------------------

async function processRule(
    rule: typeof alertRules.$inferSelect,
    context: AlertContext,
    now: number
): Promise<void> {
    // ------------------------------------------------------------------
    // 2. Cooldown check
    // ------------------------------------------------------------------
    if (
        rule.lastTriggeredAt != null &&
        now - rule.lastTriggeredAt < rule.cooldownSeconds * 1000
    ) {
        const remainingSeconds = Math.ceil(
            (rule.cooldownSeconds * 1000 - (now - rule.lastTriggeredAt)) / 1000
        );
        logger.debug(
            `processAlerts: rule ${rule.alertRuleId} is in cooldown – ${remainingSeconds}s remaining`
        );
        return;
    }

    // ------------------------------------------------------------------
    // 3. Mark rule as triggered (optimistic update – before sending so we
    //    don't re-trigger if the send is slow)
    // ------------------------------------------------------------------
    await db
        .update(alertRules)
        .set({ lastTriggeredAt: now })
        .where(eq(alertRules.alertRuleId, rule.alertRuleId));

    // ------------------------------------------------------------------
    // 4. Process email actions
    // ------------------------------------------------------------------
    const emailActions = await db
        .select()
        .from(alertEmailActions)
        .where(
            and(
                eq(alertEmailActions.alertRuleId, rule.alertRuleId),
                eq(alertEmailActions.enabled, true)
            )
        );

    for (const action of emailActions) {
        try {
            const recipients = await resolveEmailRecipients(
                action.emailActionId
            );
            if (recipients.length > 0) {
                await sendAlertEmail(recipients, context);
                await db
                    .update(alertEmailActions)
                    .set({ lastSentAt: now })
                    .where(
                        eq(
                            alertEmailActions.emailActionId,
                            action.emailActionId
                        )
                    );
            }
        } catch (err) {
            logger.error(
                `processAlerts: failed to send alert email for action ${action.emailActionId}`,
                err
            );
        }
    }

    // ------------------------------------------------------------------
    // 5. Process webhook actions
    // ------------------------------------------------------------------
    const webhookActions = await db
        .select()
        .from(alertWebhookActions)
        .where(
            and(
                eq(alertWebhookActions.alertRuleId, rule.alertRuleId),
                eq(alertWebhookActions.enabled, true)
            )
        );

    const serverSecret = config.getRawConfig().server.secret!;

    for (const action of webhookActions) {
        try {
            let webhookConfig: WebhookAlertConfig = { authType: "none" };

            if (action.config) {
                try {
                    const decrypted = decrypt(action.config, serverSecret);
                    webhookConfig = JSON.parse(decrypted) as WebhookAlertConfig;
                } catch (err) {
                    logger.error(
                        `processAlerts: failed to decrypt webhook config for action ${action.webhookActionId}`,
                        err
                    );
                    continue;
                }
            }

            await sendAlertWebhook(action.webhookUrl, webhookConfig, context);
            await db
                .update(alertWebhookActions)
                .set({ lastSentAt: now })
                .where(
                    eq(
                        alertWebhookActions.webhookActionId,
                        action.webhookActionId
                    )
                );
        } catch (err) {
            logger.warn(
                `processAlerts: failed to send alert webhook for action ${action.webhookActionId}`,
                err
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Email recipient resolution
// ---------------------------------------------------------------------------

/**
 * Resolves all email addresses for a given `emailActionId`.
 *
 * Recipients may be:
 * - Direct users (by `userId`)
 * - All users in a role (by `roleId`, resolved via `userOrgRoles`)
 * - Direct external email addresses
 */
async function resolveEmailRecipients(
    emailActionId: number
): Promise<string[]> {
    const rows = await db
        .select()
        .from(alertEmailRecipients)
        .where(eq(alertEmailRecipients.emailActionId, emailActionId));

    const emailSet = new Set<string>();

    for (const row of rows) {
        if (row.email) {
            emailSet.add(row.email);
        }

        if (row.userId) {
            const [user] = await db
                .select({ email: users.email })
                .from(users)
                .where(eq(users.userId, row.userId))
                .limit(1);
            if (user?.email) {
                emailSet.add(user.email);
            }
        }

        if (row.roleId) {
            // Find all users with this role via userOrgRoles
            const roleUsers = await db
                .select({ email: users.email })
                .from(userOrgRoles)
                .innerJoin(users, eq(userOrgRoles.userId, users.userId))
                .where(eq(userOrgRoles.roleId, Number(row.roleId)));

            for (const u of roleUsers) {
                if (u.email) {
                    emailSet.add(u.email);
                }
            }
        }
    }

    return Array.from(emailSet);
}
