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

import { sendEmail } from "@server/emails";
import AlertNotification from "@server/emails/templates/AlertNotification";
import config from "@server/lib/config";
import logger from "@server/logger";
import { type AlertEventType } from "@server/routers/alertRule/types";

type EmailAlertContext = {
    eventType: AlertEventType;
    orgId: string;
    /** Set for site_online / site_offline events */
    siteId?: number;
    /** Set for health_check_* events */
    healthCheckId?: number;
    /** Set for resource_* events */
    resourceId?: number;
    /** Human-readable context data included in emails and webhook payloads */
    data: Record<string, unknown>;
    isTest?: boolean;
};

/**
 * Sends an alert notification email to every address in `recipients`.
 *
 * Each recipient receives an individual email (no BCC list) so that delivery
 * failures for one address do not affect the others.  Failures per recipient
 * are logged and swallowed – the caller only sees an error if something goes
 * wrong before the send loop.
 */
export async function sendAlertEmail(
    recipients: string[],
    context: EmailAlertContext
): Promise<void> {
    if (recipients.length === 0) {
        return;
    }

    const from = config.getNoReplyEmail();
    const subject = buildSubject(context);

    const baseUrl = config.getRawConfig().app.dashboard_url!.replace(/\/$/, "");
    const dashboardLink = `${baseUrl}/${context.orgId}/settings`;

    for (const to of recipients) {
        try {
            await sendEmail(
                AlertNotification({
                    eventType: context.eventType,
                    orgId: context.orgId,
                    data: context.data,
                    dashboardLink,
                    isTestAlert: context.isTest
                }),
                {
                    from,
                    to,
                    subject
                }
            );
            logger.debug(
                `Alert email sent to "${to}" for event "${context.eventType}"`
            );
        } catch (err) {
            logger.error(
                `sendAlertEmail: failed to send alert email to "${to}" for event "${context.eventType}"`,
                err
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSubject(context: EmailAlertContext): string {
    const prefix = context.isTest ? "[Test Alert]" : "[Alert]";
    switch (context.eventType) {
        case "site_online":
            return `${prefix} Site Back Online`;
        case "site_offline":
            return `${prefix} Site Offline`;
        case "site_toggle":
            return `${prefix} Site Status Changed`;
        case "health_check_healthy":
            return `${prefix} Health Check Recovered`;
        case "health_check_unhealthy":
            return `${prefix} Health Check Failing`;
        case "health_check_toggle":
            return `${prefix} Health Check Status Changed`;
        case "resource_healthy":
            return `${prefix} Resource Healthy`;
        case "resource_unhealthy":
            return `${prefix} Resource Unhealthy`;
        case "resource_degraded":
            return `${prefix} Resource Degraded`;
        case "resource_toggle":
            return `${prefix} Resource Status Changed`;
        default: {
            // Exhaustiveness fallback – should never be reached with a
            // well-typed caller, but keeps runtime behaviour predictable.
            const _exhaustive: never = context.eventType;
            void _exhaustive;
            return `${prefix} Event Notification`;
        }
    }
}
