import { assertEquals } from "@test/assert";
import {
    sweepConnection,
    sweepAllConnections,
    HeartbeatConnection
} from "./heartbeat";

class FakeConnection implements HeartbeatConnection {
    isAlive?: boolean;
    pingCount = 0;
    terminated = false;

    ping(): void {
        this.pingCount++;
    }

    terminate(): void {
        this.terminated = true;
    }

    // Simulates the client responding before the next sweep.
    respondWithPong(): void {
        this.isAlive = true;
    }
}

// A connection whose ping()/terminate() can be made to throw, mirroring
// what `ws`'s real ping() does when called on a socket that's still
// CONNECTING (verified against ws's own source).
class FlakyConnection implements HeartbeatConnection {
    isAlive?: boolean;
    terminated = false;
    pingThrows = false;
    terminateThrows = false;

    ping(): void {
        if (this.pingThrows) throw new Error("ping failed");
    }

    terminate(): void {
        if (this.terminateThrows) throw new Error("terminate failed");
        this.terminated = true;
    }
}

function runTests() {
    // A freshly-connected connection (isAlive not yet set) should be
    // pinged, not terminated - undefined must not be treated as "already
    // unresponsive".
    const fresh = new FakeConnection();
    sweepConnection(fresh);
    assertEquals(
        fresh.terminated,
        false,
        "A fresh connection must not be terminated on its first sweep"
    );
    assertEquals(
        fresh.pingCount,
        1,
        "A fresh connection should be pinged on its first sweep"
    );
    assertEquals(
        fresh.isAlive,
        false,
        "isAlive should be marked false pending a pong response"
    );

    // A connection that answered the previous ping (isAlive flipped back to
    // true by the pong handler) should be pinged again, not terminated.
    const responsive = new FakeConnection();
    responsive.isAlive = true;
    sweepConnection(responsive);
    assertEquals(
        responsive.terminated,
        false,
        "A responsive connection must not be terminated"
    );
    assertEquals(
        responsive.pingCount,
        1,
        "A responsive connection should be pinged again"
    );

    // A connection that never answered the previous ping (isAlive still
    // false from last sweep) must be terminated, and not pinged again.
    const dead = new FakeConnection();
    dead.isAlive = false;
    sweepConnection(dead);
    assertEquals(
        dead.terminated,
        true,
        "An unresponsive connection must be terminated"
    );
    assertEquals(
        dead.pingCount,
        0,
        "A terminated connection should not also be pinged"
    );

    // sweepAllConnections applies the same logic across a mixed batch.
    const batch = [new FakeConnection(), new FakeConnection()];
    batch[1].isAlive = false; // this one already missed a ping
    sweepAllConnections(batch);
    assertEquals(
        batch[0].terminated,
        false,
        "Batch: a fresh connection survives a sweep"
    );
    assertEquals(
        batch[1].terminated,
        true,
        "Batch: an already-unresponsive connection is terminated"
    );

    // Multi-cycle simulation: this is the actual claim in the PR - a truly
    // dead connection (never responds again) is detected and terminated
    // within 2 sweep cycles, not left connected indefinitely.
    const goesDark = new FakeConnection();
    sweepConnection(goesDark); // cycle 1: pinged, isAlive -> false, no pong ever comes
    assertEquals(
        goesDark.terminated,
        false,
        "Cycle 1: not yet terminated - still waiting on a pong"
    );
    sweepConnection(goesDark); // cycle 2: never got a pong since cycle 1
    assertEquals(
        goesDark.terminated,
        true,
        "Cycle 2: terminated after missing exactly one full interval"
    );

    // A connection that keeps responding (pong arrives between each sweep)
    // must survive indefinitely - proves the heartbeat can't false-positive
    // disconnect a live, responsive client.
    const staysAlive = new FakeConnection();
    for (let cycle = 0; cycle < 10; cycle++) {
        sweepConnection(staysAlive);
        staysAlive.respondWithPong(); // simulates the pong handler firing before the next sweep
    }
    assertEquals(
        staysAlive.terminated,
        false,
        "A connection that always responds must never be terminated"
    );
    assertEquals(
        staysAlive.pingCount,
        10,
        "A responsive connection is pinged every cycle"
    );

    // A connection whose ping() throws (e.g. ws's real ping() throws on a
    // still-CONNECTING socket) must not propagate - sweepConnection should
    // swallow it and fall back to terminating the connection, since this
    // runs from a bare setInterval and this app's global uncaughtException
    // handler would otherwise crash the whole server over one bad socket.
    const pingThrows = new FlakyConnection();
    pingThrows.pingThrows = true;
    let threw = false;
    try {
        sweepConnection(pingThrows);
    } catch {
        threw = true;
    }
    assertEquals(
        threw,
        false,
        "sweepConnection must not propagate a throw from ping()"
    );
    assertEquals(
        pingThrows.terminated,
        true,
        "A connection whose ping() throws should be treated as dead and terminated"
    );

    // Even if BOTH ping() and terminate() throw, sweepConnection must still
    // not propagate - there's nothing more it can do, but it must not crash
    // the sweep (or the process) either.
    const bothThrow = new FlakyConnection();
    bothThrow.pingThrows = true;
    bothThrow.terminateThrows = true;
    threw = false;
    try {
        sweepConnection(bothThrow);
    } catch {
        threw = true;
    }
    assertEquals(
        threw,
        false,
        "sweepConnection must not propagate even when both ping() and terminate() throw"
    );

    // The real-world case this protects: one bad connection in a batch must
    // not stop the other connections in the same sweep from being checked.
    const throwingFirst = new FlakyConnection();
    throwingFirst.pingThrows = true;
    const afterIt = new FakeConnection();
    const andAfterThat = new FakeConnection();
    sweepAllConnections([throwingFirst, afterIt, andAfterThat]);
    assertEquals(
        afterIt.pingCount,
        1,
        "A throwing connection must not stop sweepAllConnections from reaching the next one"
    );
    assertEquals(
        andAfterThat.pingCount,
        1,
        "...including the connection after that"
    );

    console.log("All heartbeat sweep tests passed!");
}

try {
    runTests();
} catch (error) {
    console.error("Heartbeat sweep test failed:", error);
    process.exit(1);
}
