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

// Run with: npx tsx server/private/lib/logStreaming/providers/HttpLogDestination.test.ts

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { assertEquals } from "@test/assert";
import { HttpLogDestination, parseRetryAfterMs } from "./HttpLogDestination";
import { PartialDeliveryError } from "./LogDestinationProvider";
import type { HttpConfig, LogEvent } from "../types";

type Reply = { status: number; headers?: Record<string, string> };

// Starts a server that answers each request with the next queued reply
// (200 once the queue is empty) and records every request body it sees.
async function startServer(
    replies: Reply[]
): Promise<{ server: Server; url: string; bodies: string[] }> {
    const bodies: string[] = [];
    const server = createServer((req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
            bodies.push(body);
            const reply = replies.shift() ?? { status: 200 };
            res.writeHead(reply.status, reply.headers);
            res.end();
        });
    });
    await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve)
    );
    const { port } = server.address() as AddressInfo;
    return { server, url: `http://127.0.0.1:${port}/hook`, bodies };
}

function makeEvents(count: number): LogEvent[] {
    return Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        logType: "action",
        orgId: "org",
        timestamp: 1_700_000_000 + i,
        data: { n: i + 1 }
    })) as LogEvent[];
}

function makeDestination(url: string): HttpLogDestination {
    return new HttpLogDestination({
        name: "test",
        url,
        authType: "none",
        headers: [],
        format: "json_single",
        useBodyTemplate: false
    } as HttpConfig);
}

async function testPartialDeliveryReportsDeliveredCount() {
    // Third request fails with a non-retryable error after two succeed
    const { server, url, bodies } = await startServer([
        { status: 200 },
        { status: 200 },
        { status: 500 }
    ]);
    try {
        let caught: unknown;
        try {
            await makeDestination(url).send(makeEvents(5));
        } catch (err) {
            caught = err;
        }
        assertEquals(
            caught instanceof PartialDeliveryError,
            true,
            "a failure after some events were delivered should be a PartialDeliveryError"
        );
        assertEquals(
            (caught as PartialDeliveryError).deliveredCount,
            2,
            "deliveredCount should be the number of accepted events"
        );
        assertEquals(bodies.length, 3, "sending should stop at the failure");
    } finally {
        server.close();
    }
}

async function testFirstEventFailureIsPlainError() {
    const { server, url } = await startServer([{ status: 500 }]);
    try {
        let caught: unknown;
        try {
            await makeDestination(url).send(makeEvents(3));
        } catch (err) {
            caught = err;
        }
        assertEquals(caught instanceof Error, true, "send should throw");
        assertEquals(
            caught instanceof PartialDeliveryError,
            false,
            "nothing was delivered, so the error should not be partial"
        );
    } finally {
        server.close();
    }
}

async function testRateLimitIsRetriedInPlace() {
    // A short 429 is waited out and the same event is retried
    const { server, url, bodies } = await startServer([
        { status: 200 },
        { status: 429, headers: { "Retry-After": "0" } },
        { status: 200 }
    ]);
    try {
        await makeDestination(url).send(makeEvents(2));
        assertEquals(bodies.length, 3, "the rate-limited event is resent once");
        assertEquals(
            bodies[1],
            bodies[2],
            "the retry should resend the same event"
        );
    } finally {
        server.close();
    }
}

async function testLongRetryAfterFailsWithoutWaiting() {
    const { server, url, bodies } = await startServer([
        { status: 200 },
        { status: 429, headers: { "Retry-After": "3600" } }
    ]);
    try {
        let caught: unknown;
        try {
            await makeDestination(url).send(makeEvents(3));
        } catch (err) {
            caught = err;
        }
        assertEquals(
            (caught as PartialDeliveryError).deliveredCount,
            1,
            "a long Retry-After should fail and report the delivered event"
        );
        assertEquals(bodies.length, 2, "no in-place retry for long waits");
    } finally {
        server.close();
    }
}

function testParseRetryAfter() {
    assertEquals(parseRetryAfterMs("2"), 2000, "seconds");
    assertEquals(parseRetryAfterMs("0.5"), 500, "fractional seconds");
    assertEquals(parseRetryAfterMs(null), 1000, "missing header uses default");
    assertEquals(parseRetryAfterMs("soon"), 1000, "garbage uses default");
    const inFiveSeconds = new Date(Date.now() + 5000).toUTCString();
    const fromDate = parseRetryAfterMs(inFiveSeconds);
    assertEquals(
        fromDate > 3000 && fromDate <= 5000,
        true,
        `HTTP date should parse to about 5s, got ${fromDate}`
    );
}

async function runTests() {
    console.log("Running HttpLogDestination tests...");
    testParseRetryAfter();
    await testPartialDeliveryReportsDeliveredCount();
    await testFirstEventFailureIsPlainError();
    await testRateLimitIsRetriedInPlace();
    await testLongRetryAfterFailsWithoutWaiting();
    console.log("All HttpLogDestination tests passed");
}

runTests().catch((error) => {
    console.error(error);
    process.exit(1);
});
