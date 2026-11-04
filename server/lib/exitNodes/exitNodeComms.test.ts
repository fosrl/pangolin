import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { assertEquals } from "@test/assert";
import { sendToExitNode } from "./exitNodeComms";

// A Gerbil that accepts the connection but never answers. Without a request
// timeout the call below never settles, so each attempt is raced against a
// watchdog to make the failure observable instead of hanging the test run.
const WATCHDOG_MS = 3000;

async function settle(
    port: number,
    method: "POST" | "DELETE" | "GET" | "PUT"
): Promise<string> {
    const exitNode = {
        exitNodeId: 1,
        reachableAt: `http://127.0.0.1:${port}`
    } as any;

    let watchdog: NodeJS.Timeout | undefined;
    const hung = new Promise<string>((resolve) => {
        watchdog = setTimeout(() => resolve("HUNG"), WATCHDOG_MS);
    });
    const attempt = sendToExitNode(exitNode, {
        localPath: "/peer",
        method,
        data: method === "POST" || method === "PUT" ? { a: 1 } : undefined,
        timeoutMs: 200
    }).then(
        () => "RESOLVED",
        (error) => (error as { code?: string }).code ?? "REJECTED"
    );
    const result = await Promise.race([attempt, hung]);
    clearTimeout(watchdog);
    return result;
}

async function testUnresponsiveExitNodeTimesOut() {
    console.log("Running exit node timeout tests...");

    const sockets = new Set<import("node:net").Socket>();
    const server = createServer(() => {
        // never respond
    });
    server.on("connection", (s) => sockets.add(s));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    try {
        for (const method of ["POST", "DELETE", "GET", "PUT"] as const) {
            assertEquals(
                await settle(port, method),
                "ECONNABORTED",
                `${method} to an unresponsive exit node must time out`
            );
        }
    } finally {
        sockets.forEach((s) => s.destroy());
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

async function runTests() {
    try {
        await testUnresponsiveExitNodeTimesOut();
        console.log("All exit node comms tests passed!");
        process.exit(0);
    } catch (error) {
        console.error("Test failed:", error);
        process.exit(1);
    }
}

runTests();
