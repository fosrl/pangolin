import { assertEquals } from "@test/assert";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { insertRowsAtomically } from "./insertRowsAtomically";

// Guards the atomicity of the buffered audit-log flush in logRequestAudit.ts.
//
// These tests drive the real `insertRowsAtomically()` that flushAuditLogs()
// calls in production, against a real SQLite database - not a re-implementation
// of it. If the helper were reverted to handing better-sqlite3 an `async`
// transaction callback, the first test below fails.
//
// Background: better-sqlite3's transaction() is synchronous - it runs BEGIN,
// invokes the callback, then COMMIT. An `async` callback returns a promise at
// its first `await`, so COMMIT fires on an empty transaction before any insert
// has run, and the inserts then execute in autocommit mode. A failure partway
// through therefore leaves earlier rows committed, which matters because
// flushAuditLogs() re-queues the whole slice on error and would duplicate them.

const rows = sqliteTable("rows", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    val: text("val").notNull()
});

const BATCH_DB_SIZE = 25;

function freshDb() {
    const sqlite = new Database(":memory:");
    const db = drizzle(sqlite, { schema: { rows } });
    db.run(
        sql`CREATE TABLE rows (id INTEGER PRIMARY KEY AUTOINCREMENT, val TEXT NOT NULL)`
    );
    return { db, sqlite };
}

function makeRows(n: number) {
    return Array.from({ length: n }, (_, i) => ({ val: `row-${i}` }));
}

function countRows(sqlite: Database.Database): number {
    return (
        sqlite.prepare("SELECT COUNT(*) AS c FROM rows").get() as {
            c: number;
        }
    ).c;
}

async function runTests() {
    console.log("Running audit log transaction atomicity tests...");

    // A mid-flush failure must roll back every batch. We force the failure from
    // inside the insert path by making one row violate NOT NULL, so the error
    // originates in the same place a real database error would.
    {
        const { db, sqlite } = freshDb();
        const toWrite: { val: string | null }[] = makeRows(60); // 25 / 25 / 10
        toWrite[55].val = null; // lands in the third batch
        let threw = false;

        try {
            await insertRowsAtomically(
                db,
                "sqlite",
                rows,
                toWrite,
                BATCH_DB_SIZE
            );
        } catch {
            threw = true;
        }

        assertEquals(threw, true, "The failure should surface to the caller");
        assertEquals(
            countRows(sqlite),
            0,
            "A failed flush must roll back every batch, leaving no rows behind"
        );
        sqlite.close();
    }

    // The happy path must still commit everything, across multiple batches.
    {
        const { db, sqlite } = freshDb();
        await insertRowsAtomically(
            db,
            "sqlite",
            rows,
            makeRows(60),
            BATCH_DB_SIZE
        );
        assertEquals(
            countRows(sqlite),
            60,
            "A successful flush must commit every batch"
        );
        sqlite.close();
    }

    // An empty flush should be a no-op rather than opening a transaction.
    {
        const { db, sqlite } = freshDb();
        await insertRowsAtomically(db, "sqlite", rows, [], BATCH_DB_SIZE);
        assertEquals(countRows(sqlite), 0, "An empty flush writes nothing");
        sqlite.close();
    }

    // Documents the underlying driver behaviour this fix exists for: handing
    // better-sqlite3 an async callback commits before the first insert runs, so
    // nothing can be rolled back. This is what insertRowsAtomically() avoids.
    {
        const { db, sqlite } = freshDb();
        const toWrite = makeRows(60);
        let inTransactionAfterFirstAwait: boolean | null = null;

        try {
            await (db as any).transaction(async (tx: any) => {
                for (let i = 0; i < toWrite.length; i += BATCH_DB_SIZE) {
                    if (i >= 50) {
                        throw new Error("simulated failure on third batch");
                    }
                    await tx
                        .insert(rows)
                        .values(toWrite.slice(i, i + BATCH_DB_SIZE));
                    if (inTransactionAfterFirstAwait === null) {
                        inTransactionAfterFirstAwait = sqlite.inTransaction;
                    }
                }
            });
        } catch {
            // expected
        }

        assertEquals(
            inTransactionAfterFirstAwait,
            false,
            "better-sqlite3 commits before an async callback's first await resolves"
        );
        assertEquals(
            countRows(sqlite),
            50,
            "An async callback leaves earlier batches committed - the regression this guards against"
        );
        sqlite.close();
    }

    console.log("All audit log transaction atomicity tests passed!");
}

runTests()
    .then(() => {
        console.log("\nAll tests passed successfully!");
    })
    .catch((error) => {
        console.error("Audit log transaction test failed:", error);
        process.exit(1);
    });
