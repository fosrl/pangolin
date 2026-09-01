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

// ---------------------------------------------------------------------------
// Log type identifiers
// ---------------------------------------------------------------------------

export type LogType = "request" | "action" | "access" | "connection" | "aiSession";

export const LOG_TYPES: LogType[] = [
    "request",
    "action",
    "access",
    "connection",
    "aiSession"
];

// ---------------------------------------------------------------------------
// A normalised event ready to be forwarded to a destination
// ---------------------------------------------------------------------------

export interface LogEvent {
    /** The auto-increment primary key from the source table */
    id: number;
    /** Which log table this event came from */
    logType: LogType;
    /** The organisation that owns this event */
    orgId: string;
    /** Unix epoch seconds – taken from the record's own timestamp field */
    timestamp: number;
    /** Full row data from the source table, serialised as a plain object */
    data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// A batch of events destined for a single streaming target
// ---------------------------------------------------------------------------

export interface LogBatch {
    destinationId: number;
    logType: LogType;
    events: LogEvent[];
}

// ---------------------------------------------------------------------------
// HTTP destination configuration (mirrors HttpConfig in the UI component)
// ---------------------------------------------------------------------------

export type AuthType = "none" | "bearer" | "basic" | "custom";

/**
 * Controls how the batch of events is serialised into the HTTP request body.
 *
 * - `json_array`   – `[{…}, {…}]`  - default; one POST per batch wrapped in a
 *                    JSON array.  Works with most generic webhooks and Datadog.
 * - `ndjson`       – `{…}\n{…}`    - newline-delimited JSON, one object per
 *                    line.  Required by Splunk HEC, Elastic/OpenSearch, Loki.
 * - `json_single`  – one HTTP POST per event, body is a plain JSON object.
 *                    Use only for endpoints that cannot handle batches at all.
 */
export type PayloadFormat = "json_array" | "ndjson" | "json_single";

export interface HttpConfig {
    /** Human-readable label for the destination */
    name: string;
    /** Target URL that will receive POST requests */
    url: string;
    /** Authentication strategy to use */
    authType: AuthType;
    /** Used when authType === "bearer" */
    bearerToken?: string;
    /** Used when authType === "basic" – must be "username:password" */
    basicCredentials?: string;
    /** Used when authType === "custom" – header name */
    customHeaderName?: string;
    /** Used when authType === "custom" – header value */
    customHeaderValue?: string;
    /** Additional static headers appended to every request */
    headers: Array<{ key: string; value: string }>;
    /** Whether to render a custom body template instead of the default shape */
    /**
     * How events are serialised into the request body.
     * Defaults to `"json_array"` when absent.
     */
    format?: PayloadFormat;
    useBodyTemplate: boolean;
    /**
     * Handlebars-style template for the JSON body of each event.
     *
     * Supported placeholders:
     *   {{event}}     – the LogType string ("request", "action", etc.)
     *   {{timestamp}} – ISO-8601 UTC string derived from the event's timestamp
     *   {{data}}      – raw JSON object (no surrounding quotes) of the full row
     *
     * Example:
     *   { "event": "{{event}}", "ts": "{{timestamp}}", "payload": {{data}} }
     */
    bodyTemplate?: string;
}

// ---------------------------------------------------------------------------
// S3 destination configuration
// ---------------------------------------------------------------------------

/**
 * Controls how the batch of events is serialised into each S3 object.
 *
 * - `json_array` – `[{…}, {…}]`  – default; each object is a JSON array.
 * - `ndjson`     – `{…}\n{…}`    – newline-delimited JSON, one object per line.
 * - `csv`        – RFC-4180 CSV with a header row derived from the event fields.
 */
export type S3PayloadFormat = "json_array" | "ndjson" | "csv";

export interface S3Config {
    /** Human-readable label for the destination */
    name: string;
    /** AWS Access Key ID */
    accessKeyId: string;
    /** AWS Secret Access Key */
    secretAccessKey: string;
    /** AWS region (e.g. "us-east-1") */
    region: string;
    /** Target S3 bucket name */
    bucket: string;
    /** Optional key prefix – appended before the auto-generated path */
    prefix?: string;
    /** Override the S3 endpoint for S3-compatible storage (e.g. MinIO, R2) */
    endpoint?: string;
    /** How events are serialised into each object. Defaults to "json_array". */
    format: S3PayloadFormat;
    /** Whether to gzip-compress the object before upload. */
    gzip: boolean;
}

// ---------------------------------------------------------------------------
// Per-destination per-log-type cursor (reflects the DB table)
// ---------------------------------------------------------------------------

export interface StreamingCursor {
    destinationId: number;
    logType: LogType;
    /** The `id` of the last row that was successfully forwarded */
    lastSentId: number;
    /** Epoch milliseconds of the last successful send (or null if never sent) */
    lastSentAt: number | null;
}

// ---------------------------------------------------------------------------
// In-memory failure / back-off state tracked per destination
// ---------------------------------------------------------------------------

export interface DestinationFailureState {
    /** How many consecutive send failures have occurred */
    consecutiveFailures: number;
    /** Date.now() value after which the destination may be retried */
    nextRetryAt: number;
    /** Date.now() value of the very first failure in the current streak */
    firstFailedAt: number;
}
