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

// Runs the real gateway and bridge against a real Redis, with real sockets.
//
//   docker run -d --name ws-gw-test -p 16399:6379 redis:latest
//   WS_GATEWAY_TEST_REDIS_PORT=16399 WS_GATEWAY_TEST_REDIS_CONTAINER=ws-gw-test \
//       npx tsx server/private/wsGateway/gateway.test.ts
//
// The Redis is flushed. WS_GATEWAY_TEST_REDIS_CONTAINER is optional and enables
// the tests that restart it.

import { execFileSync } from "child_process";
import { createHash, randomUUID } from "crypto";
import net from "net";
import zlib from "zlib";
import Redis from "ioredis";
import { WebSocket } from "ws";
import { assertEquals } from "@test/assert";
import { BridgeHandlers, WsGatewayBridge } from "./bridge";
import { WsGateway } from "./gateway";
import { AUTH_STREAM, INBOUND_STREAM, presenceKey } from "./protocol";

const redisPort = Number(process.env.WS_GATEWAY_TEST_REDIS_PORT);
const redisContainer = process.env.WS_GATEWAY_TEST_REDIS_CONTAINER;
const redisOptions = { host: "127.0.0.1", port: redisPort };

const quiet = { info() {}, warn() {}, error() {} };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => boolean | Promise<boolean>, what: string) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        if (await check()) return;
        await sleep(10);
    }
    throw new Error(`Timed out waiting for ${what}`);
}

const hash = (token: string) =>
    createHash("sha256").update(token).digest("hex");

// Stands in for the database: maps each token's hash to a client
const devices = new Map<string, { clientId: string; siteId?: number }>();
function addDevice(token: string, clientId: string, siteId?: number) {
    devices.set(hash(token), { clientId, siteId });
}

interface TestPangolin {
    bridge: WsGatewayBridge;
    frames: { clientId: string; text: string }[];
    sites: number[];
}

function startPangolin(
    redis: Redis,
    overrides: Partial<BridgeHandlers> = {},
    options: { claimMinIdleMs?: number; claimIntervalMs?: number } = {}
): TestPangolin {
    const pangolin: TestPangolin = {
        frames: [],
        sites: [],
        bridge: undefined as unknown as WsGatewayBridge
    };
    pangolin.bridge = new WsGatewayBridge({
        redis,
        nodeId: randomUUID(),
        logger: quiet,
        claimMinIdleMs: 200,
        claimIntervalMs: 100,
        ...options,
        handlers: {
            authenticate: async ({ sessionId }) => {
                const device = devices.get(sessionId);
                return device ? { ok: true, ...device } : { ok: false };
            },
            prepareFrames: async () => {},
            handleFrame: async ({ clientId, data, isBinary }) => {
                pangolin.frames.push({
                    clientId,
                    text: (isBinary ? zlib.gunzipSync(data) : data).toString()
                });
            },
            handleSiteLiveness: (siteIds) => pangolin.sites.push(...siteIds),
            ...overrides
        }
    });
    pangolin.bridge.start();
    return pangolin;
}

let nextPort = 23100;

async function startGateway(extra = {}) {
    const port = nextPort++;
    const gateway = new WsGateway({
        port,
        redis: redisOptions,
        logger: quiet,
        drainMs: 100,
        ...extra
    });
    await gateway.start();
    return { gateway, port };
}

interface TestDevice {
    ws: WebSocket;
    received: string[];
    closeCode?: number;
}

function connect(port: number, token: string, query = ""): Promise<TestDevice> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(
            `ws://127.0.0.1:${port}/api/v1/ws?token=${token}${query}`
        );
        const device: TestDevice = { ws, received: [] };
        ws.on("message", (data: Buffer, isBinary) => {
            device.received.push(
                (isBinary ? zlib.gunzipSync(data) : data).toString()
            );
        });
        ws.on("close", (code) => {
            device.closeCode = code;
        });
        ws.on("open", () => resolve(device));
        ws.on("unexpected-response", (_req, res) => {
            reject(new Error(`HTTP ${res.statusCode}`));
        });
        ws.on("error", reject);
    });
}

async function expectRejected(promise: Promise<unknown>, status: string) {
    try {
        await promise;
    } catch (error) {
        assertEquals((error as Error).message, status, "connection rejected");
        return;
    }
    throw new Error(`Expected ${status}`);
}

const tests: [string, () => Promise<void>][] = [];
const test = (name: string, run: () => Promise<void>) =>
    tests.push([name, run]);

let redis: Redis;

test("authenticates devices without putting their tokens in Redis", async () => {
    const pangolin = startPangolin(redis);
    const { gateway, port } = await startGateway();
    addDevice("good-token", "newt-1");

    const seen: string[] = [];
    const monitor = await redis.monitor();
    monitor.on("monitor", (_time, args) => seen.push(args.join(" ")));

    const device = await connect(port, "good-token");
    await expectRejected(connect(port, "bad-token"), "HTTP 401");
    await expectRejected(
        connect(port, "good-token", "&clientType=nonsense"),
        "HTTP 401"
    );
    await sleep(50);
    monitor.disconnect();

    assertEquals(
        seen.some((line) => line.includes("good-token")),
        false,
        "raw token never reaches Redis"
    );
    assertEquals(
        seen.some((line) => line.includes(hash("good-token"))),
        true,
        "token hash does"
    );

    device.ws.close();
    await pangolin.bridge.stop();
    await gateway.stop();
});

test("answers 503, not 401, when no Pangolin is there to authenticate", async () => {
    const { gateway, port } = await startGateway();
    addDevice("token", "newt-1");
    await expectRejected(connect(port, "token"), "HTTP 503");
    await gateway.stop();
});

test("a Pangolin that fails to authenticate leads to 503, not 401", async () => {
    const pangolin = startPangolin(redis, {
        authenticate: async () => {
            throw new Error("database down");
        }
    });
    const { gateway, port } = await startGateway();
    await expectRejected(connect(port, "token"), "HTTP 503");
    await pangolin.bridge.stop();
    await gateway.stop();
});

test("a device resetting its connection during auth doesn't crash the gateway", async () => {
    const { gateway, port } = await startGateway();
    await new Promise<void>((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1", () => {
            socket.write(
                `GET /api/v1/ws?token=abc HTTP/1.1\r\nHost: 127.0.0.1\r\n` +
                    `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
                    `Sec-WebSocket-Version: 13\r\n` +
                    `Sec-WebSocket-Key: ${Buffer.alloc(16).toString("base64")}\r\n\r\n`
            );
            // Long enough for the request to be waiting on Pangolin
            setTimeout(() => {
                socket.resetAndDestroy();
                resolve();
            }, 100);
        });
        socket.on("error", reject);
    });
    await sleep(200);
    assertEquals(
        (await fetch(`http://127.0.0.1:${port}/healthz`)).status,
        200,
        "gateway still up"
    );
    await gateway.stop();
});

test("carries frames both ways, text and gzipped", async () => {
    const pangolin = startPangolin(redis);
    const { gateway, port } = await startGateway();
    addDevice("token", "newt-1");
    const device = await connect(port, "token");

    device.ws.send("hello");
    device.ws.send(zlib.gzipSync("zipped"), { binary: true });
    await waitFor(() => pangolin.frames.length === 2, "frames");
    assertEquals(pangolin.frames[0].clientId, "newt-1", "sender");
    assertEquals(pangolin.frames[0].text, "hello", "text frame");
    assertEquals(pangolin.frames[1].text, "zipped", "binary frame");

    const delivered = await pangolin.bridge.deliver([
        { clientId: "newt-1", data: "reply", isBinary: false },
        { clientId: "newt-1", data: zlib.gzipSync("big"), isBinary: true },
        { clientId: "not-connected", data: "x", isBinary: false }
    ]);
    assertEquals(delivered.join(), "true,true,false", "presence decides");
    await waitFor(() => device.received.length === 2, "replies");
    assertEquals(device.received.join(), "reply,big", "replies in order");

    device.ws.close();
    await pangolin.bridge.stop();
    await gateway.stop();
});

test("a Pangolin restart keeps sockets open and loses no frames", async () => {
    const first = startPangolin(redis);
    const { gateway, port } = await startGateway();
    addDevice("token", "newt-1");
    const device = await connect(port, "token");

    device.ws.send("before");
    await waitFor(() => first.frames.length === 1, "first frame");

    await first.bridge.stop();
    for (let i = 0; i < 500; i++) {
        device.ws.send(`during-${i}`);
    }
    await sleep(100);
    assertEquals(device.ws.readyState, WebSocket.OPEN, "socket stays open");
    assertEquals(first.frames.length, 1, "nothing consumed while down");

    const second = startPangolin(redis);
    await waitFor(() => second.frames.length === 500, "queued frames");
    assertEquals(
        new Set(second.frames.map((frame) => frame.text)).size,
        500,
        "each frame exactly once"
    );

    await second.bridge.deliver([
        { clientId: "newt-1", data: "after", isBinary: false }
    ]);
    await waitFor(() => device.received.length === 1, "reply after restart");
    await waitFor(
        async () => (await redis.xlen(INBOUND_STREAM)) === 0,
        "handled frames to leave Redis"
    );

    device.ws.close();
    await second.bridge.stop();
    await gateway.stop();
});

test("frames from a Pangolin that died mid-handling go to another", async () => {
    let started = 0;
    const dying = startPangolin(redis, {
        // Never finishes and never acknowledges, like a killed process
        handleFrame: () => {
            started++;
            return new Promise(() => {});
        }
    });
    const { gateway, port } = await startGateway();
    addDevice("token", "newt-1");
    const device = await connect(port, "token");

    device.ws.send("in-flight");
    await waitFor(() => started === 1, "frame to be picked up");

    // Stops its loops and keepalive. The stuck frame stays pending, as it
    // would after a crash.
    const stopping = dying.bridge.stop();

    const survivor = startPangolin(redis);
    await waitFor(() => survivor.frames.length === 1, "frame to be claimed");
    assertEquals(survivor.frames[0].text, "in-flight", "claimed frame");

    device.ws.close();
    await survivor.bridge.stop();
    await gateway.stop();
    await stopping;
});

test("a slow handler on a live Pangolin isn't claimed by another", async () => {
    let handled = 0;
    let finish = () => {};
    const slow = startPangolin(redis, {
        handleFrame: () => {
            handled++;
            return new Promise<void>((resolve) => {
                finish = resolve;
            });
        }
    });
    const other = startPangolin(redis);
    const { gateway, port } = await startGateway();
    addDevice("token", "newt-1");
    const device = await connect(port, "token");

    // Whichever Pangolin got it, it has to stay there
    device.ws.send("slow");
    await waitFor(() => handled + other.frames.length === 1, "frame");
    if (handled === 1) {
        await sleep(800);
        assertEquals(other.frames.length, 0, "not claimed while in progress");
        assertEquals(handled, 1, "not run twice");
    }
    finish();

    device.ws.close();
    await slow.bridge.stop();
    await other.bridge.stop();
    await gateway.stop();
});

test("frames too old to matter are dropped", async () => {
    const pangolin = startPangolin(redis);
    const { encodeMessageFields } = await import("./protocol");
    await redis.xadd(
        INBOUND_STREAM,
        "*",
        ...encodeMessageFields(
            "newt-1",
            "newt",
            Date.now() - 10 * 60 * 1000,
            false,
            Buffer.from("stale")
        )
    );
    await waitFor(
        async () => (await redis.xlen(INBOUND_STREAM)) === 0,
        "stale frame to be removed"
    );
    assertEquals(pangolin.frames.length, 0, "stale frame not handled");
    await pangolin.bridge.stop();
});

test("each gateway delivers only to its own sockets, and each frame once", async () => {
    const pangolin = startPangolin(redis);
    const a = await startGateway();
    const b = await startGateway();
    addDevice("token-a", "client-a");
    addDevice("token-b", "client-b");
    const deviceA = await connect(a.port, "token-a");
    const deviceB = await connect(b.port, "token-b");
    await waitFor(
        async () =>
            (await redis.exists(
                presenceKey("client-a"),
                presenceKey("client-b")
            )) === 2,
        "presence"
    );

    await pangolin.bridge.deliver([
        { clientId: "client-a", data: "for-a", isBinary: false },
        { clientId: "client-b", data: "for-b", isBinary: false }
    ]);
    await waitFor(
        () => deviceA.received.length + deviceB.received.length === 2,
        "delivery"
    );
    await sleep(100);
    assertEquals(deviceA.received.join(), "for-a", "gateway a");
    assertEquals(deviceB.received.join(), "for-b", "gateway b");

    await pangolin.bridge.broadcast("client-a", "all", false);
    await waitFor(() => deviceB.received.length === 2, "broadcast");
    assertEquals(deviceA.received.length, 1, "excluded client skipped");

    await pangolin.bridge.disconnect("client-b");
    await waitFor(() => deviceB.closeCode === 1000, "disconnect");
    await waitFor(
        async () => (await redis.exists(presenceKey("client-b"))) === 0,
        "presence removal"
    );
    assertEquals(
        await redis.exists(presenceKey("client-a")),
        1,
        "other client unaffected"
    );

    deviceA.ws.close();
    await pangolin.bridge.stop();
    await a.gateway.stop();
    await b.gateway.stop();
});

test("a late close doesn't hide a client that already reconnected", async () => {
    const pangolin = startPangolin(redis);
    const a = await startGateway();
    const b = await startGateway();
    addDevice("token", "client-a");

    const oldSocket = await connect(a.port, "token");
    const newSocket = await connect(b.port, "token");
    await sleep(50);
    oldSocket.ws.close();
    await waitFor(() => a.gateway.connectionCount === 0, "old socket closing");
    await sleep(50);

    const [delivered] = await pangolin.bridge.deliver([
        { clientId: "client-a", data: "still-here", isBinary: false }
    ]);
    assertEquals(delivered, true, "presence survives the old close");
    await waitFor(() => newSocket.received.length === 1, "delivery");

    newSocket.ws.close();
    await pangolin.bridge.stop();
    await a.gateway.stop();
    await b.gateway.stop();
});

test("one Pangolin in a region claims a cross-region forward", async () => {
    const a = startPangolin(redis);
    const b = startPangolin(redis);
    const claims = await Promise.all([
        a.bridge.claimForward("message-1"),
        b.bridge.claimForward("message-1"),
        a.bridge.claimForward("message-1")
    ]);
    assertEquals(claims.filter(Boolean).length, 1, "single winner");
    await a.bridge.stop();
    await b.bridge.stop();
});

test("reports live sites and reaps sockets that stop answering", async () => {
    const pangolin = startPangolin(redis);
    const { gateway, port } = await startGateway({ livenessIntervalMs: 100 });
    addDevice("newt-token", "newt-1", 42);
    addDevice("olm-token", "olm-1");
    const newt = await connect(port, "newt-token");
    const olm = await connect(port, "olm-token", "&clientType=olm");

    await waitFor(() => pangolin.sites.includes(42), "site liveness");
    assertEquals(gateway.connectionCount, 2, "both sockets stay connected");

    // Stop answering pings, like a device that lost its network
    (newt.ws as any)._socket.pause();
    await waitFor(() => gateway.connectionCount === 1, "dead socket reaped");
    await waitFor(
        async () => (await redis.exists(presenceKey("newt-1"))) === 0,
        "presence removal"
    );

    pangolin.sites.length = 0;
    await sleep(350);
    assertEquals(pangolin.sites.includes(42), false, "site no longer reported");

    newt.ws.terminate();
    olm.ws.close();
    await pangolin.bridge.stop();
    await gateway.stop();
});

test("draining closes sockets cleanly and fails health checks", async () => {
    const pangolin = startPangolin(redis);
    const { gateway, port } = await startGateway({ drainMs: 500 });
    addDevice("token", "newt-1");
    const device = await connect(port, "token");

    const healthy = await fetch(`http://127.0.0.1:${port}/healthz`);
    assertEquals(healthy.status, 200, "healthy before draining");

    const stopping = gateway.stop();
    const draining = await fetch(`http://127.0.0.1:${port}/healthz`);
    assertEquals(draining.status, 503, "unhealthy while draining");
    await stopping;

    await waitFor(() => device.closeCode === 1001, "close code");
    assertEquals(
        await redis.exists(presenceKey("newt-1")),
        0,
        "presence removed"
    );
    await pangolin.bridge.stop();
});

if (redisContainer) {
    const docker = (...args: string[]) =>
        execFileSync("docker", args, { stdio: "ignore" });

    test("frames sent during a Redis blip aren't lost", async () => {
        const pangolin = startPangolin(redis);
        const { gateway, port } = await startGateway();
        addDevice("token", "newt-1");
        const device = await connect(port, "token");

        docker("pause", redisContainer);
        for (let i = 0; i < 100; i++) {
            device.ws.send(`during-${i}`);
        }
        await sleep(500);
        assertEquals(device.ws.readyState, WebSocket.OPEN, "socket stays open");
        docker("unpause", redisContainer);

        await waitFor(
            () => pangolin.frames.length === 100,
            "frames after blip"
        );

        device.ws.close();
        await pangolin.bridge.stop();
        await gateway.stop();
    });

    test("recovers from Redis restarting without its data", async () => {
        const pangolin = startPangolin(redis);
        const { gateway, port } = await startGateway();
        addDevice("token", "newt-1");
        const device = await connect(port, "token");

        docker("restart", "--time", "0", redisContainer);
        await waitFor(() => redis.status === "ready", "Redis to come back");
        await sleep(1500);

        assertEquals(device.ws.readyState, WebSocket.OPEN, "socket stays open");
        device.ws.send("after-restart");
        await waitFor(
            () => pangolin.frames.length === 1,
            "frame after restart"
        );

        // New devices can still connect, which needs the auth group back too
        addDevice("second", "newt-2");
        const second = await connect(port, "second");

        second.ws.close();
        device.ws.close();
        await pangolin.bridge.stop();
        await gateway.stop();
    });
}

async function main() {
    if (!redisPort) {
        console.log("Skipped: set WS_GATEWAY_TEST_REDIS_PORT");
        return;
    }

    redis = new Redis({
        ...redisOptions,
        // Matches the regional Redis client the bridge is given in production
        commandTimeout: 5000,
        maxRetriesPerRequest: 50,
        enableReadyCheck: false
    });
    redis.on("error", () => {});

    let failed = 0;
    for (const [name, run] of tests) {
        await waitFor(() => redis.status === "ready", "Redis");
        await redis.flushall();
        await sleep(20);
        const started = Date.now();
        try {
            await run();
            console.log(`ok    ${name} (${Date.now() - started}ms)`);
        } catch (error) {
            failed++;
            console.log(`FAIL  ${name}\n      ${(error as Error).message}`);
        }
    }

    redis.disconnect();
    console.log(`\n${tests.length - failed}/${tests.length} passed`);
    process.exit(failed > 0 ? 1 : 0);
}

main();
