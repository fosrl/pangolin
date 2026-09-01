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

import logger from "@server/logger";
import {
    AlertContext,
    WebhookAlertConfig,
    type AlertEventType
} from "@server/routers/alertRule/types";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;

type WebhookAlertContext = {
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
 * Sends a single webhook POST for an alert event.
 *
 * The payload shape is:
 * ```json
 * {
 *   "event": "site_online",
 *   "timestamp": "2024-01-01T00:00:00.000Z",
 *   "data": { ... }
 * }
 * ```
 *
 * Authentication headers are applied according to `config.authType`,
 * mirroring the same strategies supported by HttpLogDestination:
 * none | bearer | basic | custom.
 */
export async function sendAlertWebhook(
    url: string,
    webhookConfig: WebhookAlertConfig,
    context: WebhookAlertContext
): Promise<void> {
    const eventType = context.eventType;
    const timestamp = new Date().toISOString();
    const status = deriveStatus(eventType, context.data);
    const data = { orgId: context.orgId, ...context.data };

    let body: Record<string, any>;
    if (webhookConfig.useBodyTemplate && webhookConfig.bodyTemplate?.trim()) {
        body = renderTemplate(webhookConfig.bodyTemplate, {
            event: eventType,
            timestamp,
            status,
            data
        });
    } else {
        body = { event: eventType, timestamp, status, data };
    }

    if (body.data && context.isTest) {
        body.data.test = true;
    }

    const headers = buildHeaders(webhookConfig);

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const controller = new AbortController();
        const timeoutHandle = setTimeout(
            () => controller.abort(),
            REQUEST_TIMEOUT_MS
        );

        let response: Response;
        try {
            response = await fetch(url, {
                method: webhookConfig.method ?? "POST",
                headers,
                body: JSON.stringify(body),
                signal: controller.signal
            });
        } catch (err: unknown) {
            clearTimeout(timeoutHandle);
            const isAbort = err instanceof Error && err.name === "AbortError";
            if (isAbort) {
                lastError = new Error(
                    `Alert webhook: request to "${url}" timed out after ${REQUEST_TIMEOUT_MS} ms`
                );
            } else {
                const msg = err instanceof Error ? err.message : String(err);
                lastError = new Error(
                    `Alert webhook: request to "${url}" failed – ${msg}`
                );
            }
            if (attempt < MAX_RETRIES) {
                const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
                logger.warn(
                    `Alert webhook: attempt ${attempt}/${MAX_RETRIES} failed – retrying in ${delay} ms. ${lastError.message}`
                );
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
            continue;
        } finally {
            clearTimeout(timeoutHandle);
        }

        if (!response.ok) {
            let snippet = "";
            try {
                const text = await response.text();
                snippet = text.slice(0, 300);
            } catch {
                // best-effort
            }
            lastError = new Error(
                `Alert webhook: server at "${url}" returned HTTP ${response.status} ${response.statusText}` +
                    (snippet ? ` – ${snippet}` : "")
            );
            if (attempt < MAX_RETRIES) {
                const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
                logger.warn(
                    `Alert webhook: attempt ${attempt}/${MAX_RETRIES} failed – retrying in ${delay} ms. ${lastError.message}`
                );
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
            continue;
        }

        logger.debug(
            `Alert webhook sent successfully to "${url}" for event "${context.eventType}" (attempt ${attempt}/${MAX_RETRIES})`
        );
        return;
    }

    throw (
        lastError ??
        new Error(
            `Alert webhook: all ${MAX_RETRIES} attempts failed for "${url}"`
        )
    );
}

// ---------------------------------------------------------------------------
// Status derivation
// ---------------------------------------------------------------------------

function deriveStatus(
    eventType: AlertContext["eventType"],
    data: Record<string, unknown>
): string {
    switch (eventType) {
        case "site_online":
            return "online";
        case "site_offline":
            return "offline";
        case "site_toggle":
            return String(data.status ?? "unknown");
        case "health_check_healthy":
        case "resource_healthy":
            return "healthy";
        case "health_check_unhealthy":
        case "resource_unhealthy":
            return "unhealthy";
        case "resource_degraded":
            return "degraded";
        case "health_check_toggle":
        case "resource_toggle":
            return String(data.status ?? "unknown");
        default: {
            const _exhaustive: never = eventType;
            void _exhaustive;
            return "unknown";
        }
    }
}

// ---------------------------------------------------------------------------
// Header construction (mirrors HttpLogDestination.buildHeaders)
// ---------------------------------------------------------------------------

function buildHeaders(
    webhookConfig: WebhookAlertConfig
): Record<string, string> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json"
    };

    switch (webhookConfig.authType) {
        case "bearer": {
            const token = webhookConfig.bearerToken?.trim();
            if (token) {
                headers["Authorization"] = `Bearer ${token}`;
            }
            break;
        }
        case "basic": {
            const creds = webhookConfig.basicCredentials?.trim();
            if (creds) {
                const encoded = Buffer.from(creds).toString("base64");
                headers["Authorization"] = `Basic ${encoded}`;
            }
            break;
        }
        case "custom": {
            const name = webhookConfig.customHeaderName?.trim();
            const value = webhookConfig.customHeaderValue ?? "";
            if (name) {
                headers[name] = value;
            }
            break;
        }
        case "none":
        default:
            break;
    }

    if (webhookConfig.headers) {
        for (const { key, value } of webhookConfig.headers) {
            if (key.trim()) {
                headers[key.trim()] = value;
            }
        }
    }

    return headers;
}

// ---------------------------------------------------------------------------
// Body template rendering
// ---------------------------------------------------------------------------

interface TemplateContext {
    event: string;
    timestamp: string;
    status: string;
    data: Record<string, unknown>;
}

/**
 * Render a body template with {{event}}, {{timestamp}}, {{status}}, {{data}},
 * and individual data-field placeholders (e.g. {{orgId}}, {{siteId}}, …).
 *
 * Replacement order:
 *   1. {{data}} → raw JSON of the full data object (prevents re-expansion of
 *      nested values that might look like placeholders).
 *   2. Top-level scalar fields from data (string values are JSON-escaped;
 *      numbers and booleans are rendered as-is). Unknown placeholders are
 *      left untouched.
 *   3. The fixed top-level keys: event, timestamp, status.
 */
function renderTemplate(
    template: string,
    ctx: TemplateContext
): Record<string, any> {
    // Step 1 – expand {{data}} first so its contents are already serialised
    // and won't be touched by later passes.
    let rendered = template.replace(/\{\{data\}\}/g, JSON.stringify(ctx.data));

    // Step 2 – expand individual data fields. Only replace placeholders whose
    // key actually exists in ctx.data; leave everything else as-is.
    for (const [key, value] of Object.entries(ctx.data)) {
        if (value === null || value === undefined) continue;
        const placeholder = new RegExp(
            `\\{\\{${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}\\}`,
            "g"
        );
        let serialised: string;
        if (typeof value === "string") {
            serialised = escapeJsonString(value);
        } else if (typeof value === "number" || typeof value === "boolean") {
            serialised = String(value);
        } else {
            serialised = escapeJsonString(JSON.stringify(value));
        }
        rendered = rendered.replace(placeholder, serialised);
    }

    // Step 3 – expand the fixed top-level keys.
    rendered = rendered
        .replace(/\{\{event\}\}/g, escapeJsonString(ctx.event))
        .replace(/\{\{timestamp\}\}/g, escapeJsonString(ctx.timestamp))
        .replace(/\{\{status\}\}/g, escapeJsonString(ctx.status));

    // Validate the rendered result is valid JSON; if not, log a warning and
    // fall back to the default payload so the webhook still fires.
    try {
        return JSON.parse(rendered);
    } catch {
        logger.warn(
            `sendAlertWebhook: body template produced invalid JSON for event ` +
                `"${ctx.event}" destined for a webhook. Falling back to default ` +
                `payload. Check that {{data}} is NOT wrapped in quotes in your template.`
        );
        return {
            event: ctx.event,
            timestamp: ctx.timestamp,
            status: ctx.status,
            data: ctx.data
        };
    }
}

function escapeJsonString(value: string): string {
    return JSON.stringify(value).slice(1, -1);
}
