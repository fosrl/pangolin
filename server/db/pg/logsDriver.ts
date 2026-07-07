import { drizzle as DrizzlePostgres } from "drizzle-orm/node-postgres";
import { readConfigFile } from "@server/lib/readConfigFile";
import { withReplicas } from "drizzle-orm/pg-core";
import { build } from "@server/build";
import { db as mainDb } from "./driver";
import { createPool } from "./poolConfig";

function createLogsDb() {
    // Only use separate logs database in SaaS builds
    if (build !== "saas") {
        return mainDb;
    }

    const config = readConfigFile();

    // Merge configs, prioritizing private config
    const logsConfig = config.postgres_logs;

    // Check environment variable first
    let connectionString = process.env.POSTGRES_LOGS_CONNECTION_STRING;
    let replicaConnections: Array<{ connection_string: string }> = [];

    if (!connectionString && logsConfig) {
        connectionString = logsConfig.connection_string;
        replicaConnections = logsConfig.replicas || [];
    }

    // If POSTGRES_LOGS_REPLICA_CONNECTION_STRINGS is set, use it
    if (process.env.POSTGRES_LOGS_REPLICA_CONNECTION_STRINGS) {
        replicaConnections =
            process.env.POSTGRES_LOGS_REPLICA_CONNECTION_STRINGS.split(",").map(
                (conn) => ({
                    connection_string: conn.trim()
                })
            );
    }

    // If no logs database is configured, fall back to main database
    if (!connectionString) {
        return mainDb;
    }

    // Create separate connection pool for logs database
    const poolConfig = logsConfig?.pool || config.postgres?.pool;
    const maxConnections = poolConfig?.max_connections || 20;
    const idleTimeoutMs = poolConfig?.idle_timeout_ms || 30000;
    const connectionTimeoutMs = poolConfig?.connection_timeout_ms || 5000;

    const primaryPool = createPool(
        connectionString,
        maxConnections,
        idleTimeoutMs,
        connectionTimeoutMs,
        "logs-primary"
    );

    const replicas = [];

    if (!replicaConnections.length) {
        replicas.push(
            DrizzlePostgres(primaryPool, {
                logger: process.env.QUERY_LOGGING == "true"
            })
        );
    } else {
        const maxReplicaConnections = poolConfig?.max_replica_connections || 20;
        for (const conn of replicaConnections) {
            const replicaPool = createPool(
                conn.connection_string,
                maxReplicaConnections,
                idleTimeoutMs,
                connectionTimeoutMs,
                "logs-replica"
            );
            replicas.push(
                DrizzlePostgres(replicaPool, {
                    logger: process.env.QUERY_LOGGING == "true"
                })
            );
        }
    }

    return withReplicas(
        DrizzlePostgres(primaryPool, {
            logger: process.env.QUERY_LOGGING == "true"
        }),
        replicas as any
    );
}

export const logsDb = createLogsDb();
export default logsDb;
export const primaryLogsDb = logsDb.$primary;
