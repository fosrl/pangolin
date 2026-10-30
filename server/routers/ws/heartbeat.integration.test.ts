// Integration test: unlike heartbeat.test.ts (which exercises
// sweepConnection/sweepAllConnections against plain fake objects), this
// spins up a REAL `ws` WebSocketServer and connects REAL WebSocket clients
// over a real TCP socket on localhost, then simulates a genuinely silent
// connection drop to prove the heartbeat catches something the pre-existing
// `close` handler cannot.
//
// IMPORTANT: the obvious way to "kill" a client - client._socket.destroy()
// - does NOT simulate the failure mode this PR targets. Verified by hand:
// on localhost, destroy() sends an immediate TCP RST, which the server's
// EXISTING `ws.on("close", ...)` handler already receives and reacts to
// (code 1006) - that case was never broken. The actual bug is a
// connection that goes silent with no close/error/RST ever reaching the
// server at all (WiFi vanishing, laptop sleep, a NAT/firewall black-holing
// packets). That's simulated here with client._socket.pause(), which stops
// the client from processing incoming frames (so no pong is ever sent)
// without tearing down the TCP connection - confirmed by hand to produce
// no `close`, no `error`, and no `pong` on the server, exactly like a real
// black hole. Only the heartbeat sweep can detect this; nothing else does.
//
// It wires connections the same way server/routers/ws/ws.ts does
// (isAlive + pong handler on `connection`, delete-on-`close`) and drives
// the sweep with the actual sweepAllConnections() this PR ships - not a
// reimplementation of it - so a pass here proves the shipped module
// works against real sockets, not just hand-rolled fakes.
//
// This does not boot the full authenticated ws.ts server (DB/session
// validation) - that's out of scope for a fast, dependency-free test.
// It isolates the heartbeat module's real-world behavior.

import { assertEquals } from "@test/assert";
import { WebSocketServer, WebSocket } from "ws";
import { sweepAllConnections } from "./heartbeat";

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withServer<T>(
    fn: (
        port: number,
        connections: Map<WebSocket & { isAlive?: boolean }, true>
    ) => Promise<T>
): Promise<T> {
    const connections = new Map<WebSocket & { isAlive?: boolean }, true>();
    const wss: WebSocketServer = await new Promise<WebSocketServer>(
        (resolve) => {
            const server = new WebSocketServer({ port: 0 });
            server.on("listening", () => resolve(server));
        }
    );

    wss.on("connection", (ws: WebSocket & { isAlive?: boolean }) => {
        ws.isAlive = true;
        connections.set(ws, true);
        ws.on("pong", () => {
            ws.isAlive = true;
        });
        ws.on("close", () => {
            connections.delete(ws);
        });
    });

    const address = wss.address();
    const port = typeof address === "object" && address ? address.port : 0;

    try {
        return await fn(port, connections);
    } finally {
        connections.forEach((_, ws) => ws.terminate());
        await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
}

function connectClient(port: number): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const client = new WebSocket(`ws://localhost:${port}`);
        client.on("open", () => resolve(client));
        client.on("error", reject);
    });
}

async function runTests() {
    // Case 1: a connection that goes silent (client stops processing
    // incoming frames, so it never answers a ping - no close/error/RST
    // ever reaches the server) must be detected and removed within 2
    // sweeps. This is the actual bug this PR fixes.
    await withServer(async (port, connections) => {
        const client = await connectClient(port);
        await wait(50); // let the server's `connection`/tracking handler run

        assertEquals(
            connections.size,
            1,
            "Server should be tracking the freshly connected real client"
        );

        // Simulate a silent black hole: stop the client from processing
        // incoming frames without tearing down the TCP connection. Verified
        // by hand this produces no close/error/pong on the server - the
        // connection just goes quiet, exactly like a real dead network path.
        (client as any)._socket.pause();
        await wait(50);
        assertEquals(
            connections.size,
            1,
            "A silently-dropped connection produces no close event on its own - proves the bug this PR fixes actually exists"
        );

        // Sweep 1: server pings every tracked connection. The silent one's
        // client never processes it, so no pong can ever arrive.
        sweepAllConnections(connections.keys());
        await wait(50);
        assertEquals(
            connections.size,
            1,
            "Cycle 1: still tracked - only marked unresponsive pending the next sweep"
        );

        // Sweep 2: the silent connection never answered - it gets
        // terminated, which fires `close`, which removes it from the map.
        sweepAllConnections(connections.keys());
        await wait(50);
        assertEquals(
            connections.size,
            0,
            "Cycle 2: the silently-dropped real connection must be terminated and removed"
        );
    });

    // Case 2: a healthy, still-connected client must NOT be dropped. `ws`
    // automatically answers a ping with a pong at the protocol level, so a
    // live client survives any number of sweeps without any extra code.
    await withServer(async (port, connections) => {
        const client = await connectClient(port);
        await wait(50);

        for (let cycle = 0; cycle < 3; cycle++) {
            sweepAllConnections(connections.keys());
            await wait(50); // let the real pong round-trip complete
        }

        assertEquals(
            connections.size,
            1,
            "A live, responsive real connection must survive repeated sweeps"
        );
        client.close();
    });

    console.log("All heartbeat integration tests passed!");
}

runTests().catch((error) => {
    console.error("Heartbeat integration test failed:", error);
    process.exit(1);
});
