import config from "@server/lib/config";
import { Pool, PoolConfig } from "pg";

export function createPoolConfig(
    connectionString: string,
    maxConnections: number,
    idleTimeoutMs: number,
    connectionTimeoutMs: number
): PoolConfig {
    return {
        connectionString,
        max: maxConnections,
        idleTimeoutMillis: idleTimeoutMs,
        connectionTimeoutMillis: connectionTimeoutMs,
        // TCP keepalive to prevent silent connection drops by NAT gateways,
        // load balancers, and other intermediate network devices (e.g. AWS
        // NAT Gateway drops idle TCP connections after ~350s)
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000, // send first keepalive after 10s of idle
        // Allow connections to be released and recreated more aggressively
        // to avoid stale connections building up
        allowExitOnIdle: false
    };
}

export function attachPoolErrorHandlers(pool: Pool, label: string): void {
    pool.on("error", (err) => {
        // This catches errors on idle clients in the pool. Without this
        // handler an unexpected disconnect would crash the process.
        console.error(
            `Unexpected error on idle ${label} database client: ${err.message}`
        );
    });

    pool.on("connect", (client) => {
        // Set a statement timeout on every new connection so a single slow
        // query can't block the pool forever
        client.query("SET statement_timeout = '30s'").catch((err: Error) => {
            console.warn(
                `Failed to set statement_timeout on ${label} client: ${err.message}`
            );
        });

        // Disable JIT compilation for this connection. Our hot-path queries
        // (e.g. resource-by-domain lookups) join many tables but only ever
        // return a handful of rows. When planner row estimates drift (e.g.
        // due to autovacuum lag under write-heavy load), Postgres decides
        // these plans are expensive enough to JIT-compile, which can add
        // multiple seconds of pure compilation overhead per query and
        // saturate the connection pool. JIT never pays off for these
        // short-lived OLTP queries, so it's disabled outright rather than
        // relying on statistics staying fresh.
        //
        // Set via a runtime SET command rather than the `options: "-c
        // jit=off"` startup parameter: connections in SaaS mode go through
        // a pooler (e.g. PgBouncer) that rejects arbitrary startup packet
        // options with a protocol_violation (08P01) error.
        if (config.getRawConfig().postgres?.pool.jit_mode == false) {
            client.query("SET jit = off").catch((err: Error) => {
                console.warn(
                    `Failed to set jit=off on ${label} client: ${err.message}`
                );
            });
        }
    });
}

export function createPool(
    connectionString: string,
    maxConnections: number,
    idleTimeoutMs: number,
    connectionTimeoutMs: number,
    label: string
): Pool {
    const pool = new Pool(
        createPoolConfig(
            connectionString,
            maxConnections,
            idleTimeoutMs,
            connectionTimeoutMs
        )
    );
    attachPoolErrorHandlers(pool, label);
    return pool;
}
