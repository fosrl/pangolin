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
import { LogEvent, HttpConfig, PayloadFormat } from "../types";
import { LogDestinationProvider } from "./LogDestinationProvider";
import { assertSafeOutboundUrl } from "@server/lib/outboundUrlGuard";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum time (ms) to wait for a single HTTP response. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Default payload format when none is specified in the config. */
const DEFAULT_FORMAT: PayloadFormat = "json_array";

// ---------------------------------------------------------------------------
// HttpLogDestination
// ---------------------------------------------------------------------------

/**
 * Forwards a batch of log events to an arbitrary HTTP endpoint via a single
 * POST request per batch.
 *
 * **Payload format**
 *
 * **Payload formats** (controlled by `config.format`):
 *
 * - `json_array` (default) - one POST per batch, body is a JSON array:
 *   ```json
 *   [
 *     { "event": "request", "timestamp": "2024-01-01T00:00:00.000Z", "data": { … } },
 *     …
 *   ]
 *   ```
 *   `Content-Type: application/json`
 *
 * - `ndjson` - one POST per batch, body is newline-delimited JSON (one object
 *   per line, no outer array).  Required by Splunk HEC, Elastic/OpenSearch,
 *   and Grafana Loki:
 *   ```
 *   {"event":"request","timestamp":"…","data":{…}}
 *   {"event":"action","timestamp":"…","data":{…}}
 *   ```
 *   `Content-Type: application/x-ndjson`
 *
 * - `json_single` - one POST **per event**, body is a plain JSON object.
 *   Use only for endpoints that cannot handle batches at all.
 *
 * With a body template each event is rendered through the template before
 * serialisation.  Template placeholders:
 *   - `{{event}}`     → the LogType string ("request", "action", etc.)
 *   - `{{timestamp}}` → ISO-8601 UTC datetime string
 *   - `{{data}}`      → raw inline JSON object  (**no surrounding quotes**)
 *
 * Example template:
 * ```
 * { "event": "{{event}}", "ts": "{{timestamp}}", "payload": {{data}} }
 * ```
 */
export class HttpLogDestination implements LogDestinationProvider {
    readonly type = "http";

    private readonly config: HttpConfig;

    constructor(config: HttpConfig) {
        this.config = config;
    }

    // -----------------------------------------------------------------------
    // LogDestinationProvider implementation
    // -----------------------------------------------------------------------

    async send(events: LogEvent[]): Promise<void> {
        if (events.length === 0) return;

        const format = this.config.format ?? DEFAULT_FORMAT;

        if (format === "json_single") {
            // One HTTP POST per event – send sequentially so a failure on one
            // event throws and lets the manager retry the whole batch from the
            // same cursor position.
            for (const event of events) {
                await this.postRequest(
                    this.buildSingleBody(event),
                    "application/json"
                );
            }
            return;
        }

        if (format === "ndjson") {
            const body = this.buildNdjsonBody(events);
            await this.postRequest(body, "application/x-ndjson");
            return;
        }

        // json_array (default)
        const body = JSON.stringify(this.buildArrayPayload(events));
        await this.postRequest(body, "application/json");
    }

    // -----------------------------------------------------------------------
    // Internal HTTP sender
    // -----------------------------------------------------------------------

    private async postRequest(
        body: string,
        contentType: string
    ): Promise<void> {
        const headers = this.buildHeaders(contentType);

        // Destination URLs are tenant-supplied: refuse this host, the
        // metadata service and (on SaaS) internal networks, and never follow
        // redirects.
        await assertSafeOutboundUrl(this.config.url);

        const controller = new AbortController();
        const timeoutHandle = setTimeout(
            () => controller.abort(),
            REQUEST_TIMEOUT_MS
        );

        let response: Response;
        try {
            response = await fetch(this.config.url, {
                method: "POST",
                headers,
                body,
                signal: controller.signal,
                redirect: "manual"
            });
        } catch (err: unknown) {
            const isAbort = err instanceof Error && err.name === "AbortError";
            if (isAbort) {
                throw new Error(
                    `HttpLogDestination: request to "${this.config.url}" timed out after ${REQUEST_TIMEOUT_MS} ms`
                );
            }
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(
                `HttpLogDestination: request to "${this.config.url}" failed – ${msg}`
            );
        } finally {
            clearTimeout(timeoutHandle);
        }

        if (!response.ok) {
            // Try to include a snippet of the response body in the error so
            // operators can diagnose auth or schema rejections.
            let responseSnippet = "";
            try {
                const text = await response.text();
                responseSnippet = text.slice(0, 300);
            } catch {
                // ignore – best effort
            }

            throw new Error(
                `HttpLogDestination: server at "${this.config.url}" returned ` +
                    `HTTP ${response.status} ${response.statusText}` +
                    (responseSnippet ? ` – ${responseSnippet}` : "")
            );
        }
    }

    // -----------------------------------------------------------------------
    // Header construction
    // -----------------------------------------------------------------------

    private buildHeaders(contentType: string): Record<string, string> {
        const headers: Record<string, string> = {
            "Content-Type": contentType
        };

        // Authentication
        switch (this.config.authType) {
            case "bearer": {
                const token = this.config.bearerToken?.trim();
                if (token) {
                    headers["Authorization"] = `Bearer ${token}`;
                }
                break;
            }
            case "basic": {
                const creds = this.config.basicCredentials?.trim();
                if (creds) {
                    const encoded = Buffer.from(creds).toString("base64");
                    headers["Authorization"] = `Basic ${encoded}`;
                }
                break;
            }
            case "custom": {
                const name = this.config.customHeaderName?.trim();
                const value = this.config.customHeaderValue ?? "";
                if (name) {
                    headers[name] = value;
                }
                break;
            }
            case "none":
            default:
                // No Authorization header
                break;
        }

        // Additional static headers (user-defined; may override Content-Type
        // if the operator explicitly sets it, which is intentional).
        for (const { key, value } of this.config.headers ?? []) {
            const trimmedKey = key?.trim();
            if (trimmedKey) {
                headers[trimmedKey] = value ?? "";
            }
        }

        return headers;
    }

    // -----------------------------------------------------------------------
    // Payload construction
    // -----------------------------------------------------------------------

    /** Single default event object (no surrounding array). */
    private buildEventObject(event: LogEvent): unknown {
        if (this.config.useBodyTemplate && this.config.bodyTemplate?.trim()) {
            return this.renderTemplate(this.config.bodyTemplate!, event);
        }
        return {
            event: event.logType,
            timestamp: epochSecondsToIso(event.timestamp),
            data: event.data
        };
    }

    /** JSON array payload – used for `json_array` format. */
    private buildArrayPayload(events: LogEvent[]): unknown[] {
        return events.map((e) => this.buildEventObject(e));
    }

    /**
     * NDJSON payload – one JSON object per line, no outer array.
     * Each line must be a complete, valid JSON object.
     */
    private buildNdjsonBody(events: LogEvent[]): string {
        return events
            .map((e) => JSON.stringify(this.buildEventObject(e)))
            .join("\n");
    }

    /** Single-event body – used for `json_single` format. */
    private buildSingleBody(event: LogEvent): string {
        return JSON.stringify(this.buildEventObject(event));
    }

    /**
     * Render a single event through the body template.
     *
     * The three placeholder tokens are replaced in a specific order to avoid
     * accidental double-replacement:
     *
     *  1. `{{data}}`      → raw JSON (may contain `{{` characters in values)
     *  2. `{{event}}`     → safe string
     *  3. `{{timestamp}}` → safe ISO string
     *
     * If the rendered string is not valid JSON we fall back to returning it as
     * a plain string so the batch still makes it out and the operator can
     * inspect the template.
     */
    private renderTemplate(template: string, event: LogEvent): unknown {
        const isoTimestamp = epochSecondsToIso(event.timestamp);
        const dataJson = JSON.stringify(event.data);

        // Replace {{data}} first because its JSON value might legitimately
        // contain the substrings "{{event}}" or "{{timestamp}}" inside string
        // fields – those should NOT be re-expanded.
        const rendered = template
            .replace(/\{\{data\}\}/g, dataJson)
            .replace(/\{\{event\}\}/g, escapeJsonString(event.logType))
            .replace(/\{\{timestamp\}\}/g, escapeJsonString(isoTimestamp));

        try {
            return JSON.parse(rendered);
        } catch {
            logger.warn(
                `HttpLogDestination: body template produced invalid JSON for ` +
                    `event type "${event.logType}" destined for "${this.config.url}". ` +
                    `Sending rendered template as a raw string. ` +
                    `Check your template syntax – specifically that {{data}} is ` +
                    `NOT wrapped in quotes.`
            );
            return rendered;
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function epochSecondsToIso(epochSeconds: number): string {
    return new Date(epochSeconds * 1000).toISOString();
}

/**
 * Escape a string value so it can be safely substituted into the interior of
 * a JSON string literal (i.e. between existing `"` quotes in the template).
 * This prevents a crafted logType or timestamp from breaking out of its
 * string context in the rendered template.
 */
function escapeJsonString(value: string): string {
    // JSON.stringify produces `"<escaped>"` – strip the outer quotes.
    return JSON.stringify(value).slice(1, -1);
}
