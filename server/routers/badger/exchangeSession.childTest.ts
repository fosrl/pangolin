// Test child for exchangeSession.test.ts. Boots the real sqlite driver
// against a fresh database in the temp workdir (cwd), seeds one org with a
// whitelist-protected resource, exchanges a one-time request token through
// the real exchangeSession handler, and prints one JSON line of
// observations. The parent asserts that the session row and the serialized
// cookie both follow resource_session_length_hours rather than the
// dashboard session length.
// The app boots with `import "./extendZod"` before anything else; zod
// schemas in the import chain use .openapi(), so do the same here.
import "@server/extendZod";
import { and, eq } from "drizzle-orm";
import {
    db,
    orgs,
    resourceSessions,
    resources,
    resourceWhitelist
} from "@server/db";
import { exchangeSession } from "@server/routers/badger/exchangeSession";
import { createResourceSession } from "@server/auth/sessions/resource";
import { generateSessionToken } from "@server/auth/sessions/app";
import config from "@server/lib/config";

async function main(): Promise<void> {
    await db.insert(orgs).values({
        orgId: "org1",
        name: "Org",
        settingsJitModeLimit: 1
    });
    await db.insert(resources).values({
        resourceId: 1,
        orgId: "org1",
        niceId: "res1",
        name: "Res",
        subdomain: "res",
        fullDomain: "res.example.com",
        ssl: true,
        emailWhitelistEnabled: true
    });
    await db.insert(resourceWhitelist).values({
        whitelistId: 1,
        email: "user@example.com",
        resourceId: 1
    });

    const requestToken = generateSessionToken();
    const now = Date.now();
    await createResourceSession({
        token: requestToken,
        resourceId: 1,
        isRequestToken: true,
        whitelistId: 1,
        doNotExtend: true,
        expiresAt: now + 10 * 60 * 1000,
        sessionLength: 10 * 60 * 1000
    });

    const startMs = Date.now();
    let captured: any = null;
    const res: any = {
        status: (_code: number) => {
            return {
                send: (payload: any) => {
                    captured = payload;
                }
            };
        }
    };
    let nextError: unknown = null;
    const req: any = {
        body: {
            requestToken: requestToken,
            host: "res.example.com"
        }
    };
    await exchangeSession(req, res, (err?: unknown) => {
        nextError = err ?? new Error("next was called");
    });

    // Read the exchanged session row through the query builder, not
    // db.get(): the pg build type-checks this file against the pg driver
    // too, and .get() exists only on the sqlite driver.
    const rows = await db
        .select()
        .from(resourceSessions)
        .where(
            and(
                eq(resourceSessions.resourceId, 1),
                eq(resourceSessions.isRequestToken, false)
            )
        );

    const cookie: string | undefined = captured?.data?.cookie;
    const expiresMatch = cookie ? cookie.match(/Expires=([^;]+)/) : null;
    const cookieExpiresMs = expiresMatch ? Date.parse(expiresMatch[1]) : null;

    console.log(
        "OBSERVATIONS " +
            JSON.stringify({
                valid: captured?.data?.valid === true,
                nextError: nextError === null ? null : String(nextError),
                sessionCount: rows.length,
                sessionExpiresAt: rows.length > 0 ? rows[0].expiresAt : null,
                sessionSessionLength:
                    rows.length > 0 ? rows[0].sessionLength : null,
                cookie: cookie ?? null,
                cookieExpiresMs: cookieExpiresMs,
                startMs: startMs,
                dashboardHours:
                    config.getRawConfig().server.dashboard_session_length_hours,
                resourceHours:
                    config.getRawConfig().server.resource_session_length_hours
            })
    );
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
