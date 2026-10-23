import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { db } from "@server/db";
import * as schema from "@server/db/sqlite/schema/schema";
import * as privateSchema from "@server/db/sqlite/schema/privateSchema";

/**
 * Creates an in memory database that only contains the tables the test needs.
 *
 * The tests use it so that they never touch the database of the server.
 */
export function createTestDb(statements: string[]): typeof db {
    const sqlite = new Database(":memory:");

    for (const statement of statements) {
        sqlite.exec(statement);
    }

    return drizzle(sqlite, {
        schema: { ...schema, ...privateSchema }
    }) as unknown as typeof db;
}
