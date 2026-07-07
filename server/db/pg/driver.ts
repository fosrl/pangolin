import { drizzle as DrizzlePostgres } from "drizzle-orm/node-postgres";
import { readConfigFile } from "@server/lib/readConfigFile";
import { withReplicas } from "drizzle-orm/pg-core";
import { createPool } from "./poolConfig";

function createDb() {
    const config = readConfigFile();

    // check the environment variables for postgres config first before the config file
    if (process.env.POSTGRES_CONNECTION_STRING) {
        config.postgres = {
            connection_string: process.env.POSTGRES_CONNECTION_STRING
        };
        if (process.env.POSTGRES_REPLICA_CONNECTION_STRINGS) {
            const replicas =
                process.env.POSTGRES_REPLICA_CONNECTION_STRINGS.split(",").map(
                    (conn) => ({
                        connection_string: conn.trim()
                    })
                );
            config.postgres.replicas = replicas;
        }
    }

    if (!config.postgres) {
        throw new Error(
            "Postgres configuration is missing in the configuration file."
        );
    }

    const connectionString = config.postgres?.connection_string;
    const replicaConnections = config.postgres?.replicas || [];

    if (!connectionString) {
        throw new Error(
            "A primary db connection string is required in the configuration file."
        );
    }

    // Create connection pools instead of individual connections
    const poolConfig = config.postgres.pool;
    const maxConnections = poolConfig?.max_connections || 20;
    const idleTimeoutMs = poolConfig?.idle_timeout_ms || 30000;
    const connectionTimeoutMs = poolConfig?.connection_timeout_ms || 5000;

    const primaryPool = createPool(
        connectionString,
        maxConnections,
        idleTimeoutMs,
        connectionTimeoutMs,
        "primary"
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
                "replica"
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

export const db = createDb();
export default db;
export const primaryDb = db.$primary as typeof db; // is this typeof a problem - technically they are different types
export type Transaction = Parameters<
    Parameters<(typeof db)["transaction"]>[0]
>[0];
export const DB_TYPE: "pg" | "sqlite" = "pg";
