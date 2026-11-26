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
 *   - `{{<field>}}`   → a single top-level field of the event's data, e.g.
 *                       `{{orgId}}` or `{{path}}`, rendered as text that is
 *                       safe inside a JSON string (use it **inside quotes**)
 *
 * Example template:
 * ```
 * { "event": "{{event}}", "ts": "{{timestamp}}", "payload": {{data}} }
 * ```
 *
 * Example for a Discord webhook (which needs strings in embed fields):
 * ```
 * { "content": "{{event}} in {{orgId}}", "embeds": [{ "description": "{{path}}" }] }
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
                signal: controller.signal
            });
        } catch (err: unknown) {
            const isAbort =
                err instanceof Error && err.name === "AbortError";
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
     * Placeholders are expanded in a single pass, so text inserted for one
     * placeholder is never expanded again (an event value that happens to
     * contain `{{event}}` stays literal):
     *
     *  - `{{data}}`      → raw JSON of the whole data object
     *  - `{{event}}`     → the log type, JSON-string-escaped
     *  - `{{timestamp}}` → ISO-8601 string, JSON-string-escaped
     *  - `{{<field>}}`   → a top-level field of `event.data`, see
     *                      {@link renderDataField}. Placeholders that name no
     *                      field are left untouched.
     *
     * The three fixed names keep their meaning even when the data object has
     * a field with the same name (request logs have a `timestamp` column).
     *
     * If the rendered string is not valid JSON we fall back to returning it as
     * a plain string so the batch still makes it out and the operator can
     * inspect the template.
     */
    private renderTemplate(template: string, event: LogEvent): unknown {
        const isoTimestamp = epochSecondsToIso(event.timestamp);

        const rendered = template.replace(
            /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g,
            (match, name: string) => {
                switch (name) {
                    case "data":
                        return JSON.stringify(event.data);
                    case "event":
                        return escapeJsonString(event.logType);
                    case "timestamp":
                        return escapeJsonString(isoTimestamp);
                }
                if (!Object.prototype.hasOwnProperty.call(event.data, name)) {
                    return match;
                }
                return renderDataField(event.data[name]);
            }
        );

        try {
            return JSON.parse(rendered);
        } catch {
            logger.warn(
                `HttpLogDestination: body template produced invalid JSON for ` +
                    `event type "${event.logType}" destined for "${this.config.url}". ` +
                    `Sending rendered template as a raw string. ` +
                    `Check your template syntax – specifically that {{data}} is ` +
                    `NOT wrapped in quotes, and that field placeholders such as ` +
                    `{{orgId}} ARE wrapped in quotes.`
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

/**
 * Render one data field for a `{{<field>}}` placeholder.
 *
 * Strings are JSON-escaped so they can sit inside a quoted string in the
 * template. Numbers and booleans are written as-is, which is valid both inside
 * and outside quotes. Objects and arrays are serialised to JSON and escaped,
 * so they also belong inside quotes. `null` and `undefined` become an empty
 * string: many log columns are nullable, and a leftover `{{field}}` or the word
 * `null` inside a message is less useful than nothing.
 */
export function renderDataField(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return escapeJsonString(value);
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    if (typeof value === "bigint") return value.toString();
    return escapeJsonString(JSON.stringify(value));
}
