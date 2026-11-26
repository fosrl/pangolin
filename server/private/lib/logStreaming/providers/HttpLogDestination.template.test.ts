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

// Run with: npx tsx server/private/lib/logStreaming/providers/HttpLogDestination.template.test.ts

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { assertEquals } from "@test/assert";
import { HttpLogDestination, renderDataField } from "./HttpLogDestination";
import type { HttpConfig, LogEvent } from "../types";

// Starts a server that accepts every request and records each body.
async function startServer(): Promise<{
    server: Server;
    url: string;
    bodies: string[];
}> {
    const bodies: string[] = [];
    const server = createServer((req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
            bodies.push(body);
            res.writeHead(204);
            res.end();
        });
    });
    await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve)
    );
    const { port } = server.address() as AddressInfo;
    return { server, url: `http://127.0.0.1:${port}/hook`, bodies };
}

// A request-log row, shaped like the ones LogStreamingManager streams.
// It has its own epoch `timestamp` column, which must not shadow {{timestamp}}.
const requestEvent: LogEvent = {
    id: 7,
    logType: "request",
    orgId: "org-1",
    timestamp: 1_700_000_000,
    data: {
        id: 7,
        orgId: "org-1",
        timestamp: 1_700_000_000,
        path: '/api/"quoted"\\path',
        method: "GET",
        reason: 100,
        tls: true,
        userId: null,
        headers: { "x-a": "1" },
        note: "contains {{event}} literally"
    }
};

// Sends one event through a json_single destination using `template` and
// returns the parsed body the endpoint received.
async function render(template: string): Promise<unknown> {
    const { server, url, bodies } = await startServer();
    try {
        const dest = new HttpLogDestination({
            name: "test",
            url,
            authType: "none",
            headers: [],
            format: "json_single",
            useBodyTemplate: true,
            bodyTemplate: template
        } as HttpConfig);
        await dest.send([requestEvent]);
        assertEquals(bodies.length, 1, "one request per event");
        return JSON.parse(bodies[0]);
    } finally {
        server.close();
    }
}

async function testDiscordStyleTemplate() {
    // The kind of template from #4129: single fields inside quoted strings.
    const body = (await render(`{
        "content": "Pangolin {{event}} in {{orgId}}",
        "embeds": [{
            "title": "{{timestamp}}",
            "description": "{{method}} {{path}}",
            "fields": [
                { "name": "Reason", "value": "{{reason}}", "inline": true },
                { "name": "TLS", "value": "{{tls}}", "inline": true },
                { "name": "User", "value": "{{userId}}", "inline": true },
                { "name": "Headers", "value": "{{headers}}" }
            ]
        }]
    }`)) as any;

    assertEquals(typeof body, "object", "body should be a JSON object");
    assertEquals(
        body.content,
        "Pangolin request in org-1",
        "{{orgId}} expands inside a quoted string"
    );
    const embed = body.embeds[0];
    assertEquals(
        embed.title,
        "2023-11-14T22:13:20.000Z",
        "{{timestamp}} stays the ISO event time, not the row's epoch column"
    );
    assertEquals(
        embed.description,
        'GET /api/"quoted"\\path',
        "string fields are escaped so quotes and backslashes survive"
    );
    assertEquals(embed.fields[0].value, "100", "numbers render as text");
    assertEquals(embed.fields[1].value, "true", "booleans render as text");
    assertEquals(embed.fields[2].value, "", "null renders as empty text");
    assertEquals(
        embed.fields[3].value,
        '{"x-a":"1"}',
        "objects render as their JSON text"
    );
}

async function testUnquotedScalarsAndRawData() {
    const body = (await render(
        `{ "reason": {{reason}}, "tls": {{tls}}, "payload": {{data}} }`
    )) as any;
    assertEquals(body.reason, 100, "unquoted numbers stay numbers");
    assertEquals(body.tls, true, "unquoted booleans stay booleans");
    assertEquals(
        body.payload.path,
        requestEvent.data.path,
        "{{data}} keeps string values intact"
    );
    assertEquals(
        body.payload.timestamp,
        1_700_000_000,
        "{{data}} still inserts the raw row"
    );
}

async function testNoReExpansionAndUnknownPlaceholders() {
    const body = (await render(
        `{ "note": "{{note}}", "missing": "{{doesNotExist}}" }`
    )) as any;
    assertEquals(
        body.note,
        "contains {{event}} literally",
        "placeholders inside a value are not expanded again"
    );
    assertEquals(
        body.missing,
        "{{doesNotExist}}",
        "placeholders that name no field are left as-is"
    );
}

async function testExistingTemplateUnchanged() {
    // The example template shown in the destination form.
    const body = (await render(
        `{ "event": "{{event}}", "timestamp": "{{timestamp}}", "data": {{data}} }`
    )) as any;
    assertEquals(body.event, "request", "{{event}} is the log type");
    assertEquals(
        body.timestamp,
        "2023-11-14T22:13:20.000Z",
        "{{timestamp}} is the ISO event time"
    );
    assertEquals(
        JSON.stringify(body.data),
        JSON.stringify(requestEvent.data),
        "{{data}} is the whole row"
    );
}

function testRenderDataField() {
    assertEquals(
        renderDataField('a"b\n'),
        'a\\"b\\n',
        "strings are JSON-escaped"
    );
    assertEquals(renderDataField(0), "0", "zero is not treated as empty");
    assertEquals(
        renderDataField(false),
        "false",
        "false is not treated as empty"
    );
    assertEquals(renderDataField(undefined), "", "undefined is empty");
    assertEquals(
        renderDataField([1, "x"]),
        '[1,\\"x\\"]',
        "arrays become escaped JSON text"
    );
}

async function runTests() {
    console.log("Running HttpLogDestination template tests...");
    await testDiscordStyleTemplate();
    await testUnquotedScalarsAndRawData();
    await testNoReExpansionAndUnknownPlaceholders();
    await testExistingTemplateUnchanged();
    testRenderDataField();
    console.log("All HttpLogDestination template tests passed!");
}

runTests().catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
});
