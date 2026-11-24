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

import { LogEvent } from "../types";

/**
 * Common interface that every log-forwarding backend must implement.
 *
 * Adding a new destination type (e.g. Datadog, Splunk, Kafka) is as simple as
 * creating a class that satisfies this interface and registering it inside
 * LogStreamingManager.createProvider().
 */
export interface LogDestinationProvider {
    /**
     * The string identifier that matches the `type` column in the
     * `eventStreamingDestinations` table (e.g. "http", "datadog").
     */
    readonly type: string;

    /**
     * Forward a batch of log events to the destination.
     *
     * Implementations should:
     *  - Treat the call as atomic: either all events are accepted or an error
     *    is thrown so the caller can retry / back off. Providers that deliver
     *    events one at a time and fail part-way through should throw a
     *    {@link PartialDeliveryError} so the caller does not resend the
     *    events that were already accepted.
     *  - Respect the timeout contract expected by the manager (default 30 s).
     *  - NOT swallow errors – the manager relies on thrown exceptions to track
     *    failure state and apply exponential back-off.
     *
     * @param events  A non-empty array of normalised log events to forward.
     * @throws        Any network, authentication, or serialisation error.
     */
    send(events: LogEvent[]): Promise<void>;
}

/**
 * Thrown by a provider when it delivered the first `deliveredCount` events of
 * a batch (in order) before failing on the next one. The manager advances its
 * cursor past the delivered events before applying back-off, so a retry picks
 * up where delivery stopped instead of replaying the whole batch.
 */
export class PartialDeliveryError extends Error {
    readonly deliveredCount: number;

    constructor(deliveredCount: number, cause: unknown) {
        const msg = cause instanceof Error ? cause.message : String(cause);
        super(msg, { cause });
        this.name = "PartialDeliveryError";
        this.deliveredCount = deliveredCount;
    }
}
