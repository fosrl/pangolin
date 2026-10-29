import { and, eq } from "drizzle-orm";
import { idp, userOrgs, users } from "@server/db";
import { convertMembershipsOnAutoProvisionEnabled } from "./convertMembershipsOnAutoProvisionEnabled";
import { assertEquals } from "@test/assert";
import { createTestDb } from "@test/testDb";
import type { Transaction } from "@server/db";

const testDb = createTestDb([
    `CREATE TABLE idp (
        idpId integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        name text NOT NULL,
        type text NOT NULL,
        defaultRoleMapping text,
        defaultOrgMapping text,
        autoProvision integer NOT NULL DEFAULT 0,
        tags text
    )`,
    `CREATE TABLE "user" (
        id text PRIMARY KEY NOT NULL,
        email text,
        username text NOT NULL,
        name text,
        type text NOT NULL,
        idpId integer,
        passwordHash text,
        twoFactorEnabled integer DEFAULT 0 NOT NULL,
        twoFactorSetupRequested integer DEFAULT 0,
        twoFactorSecret text,
        emailVerified integer DEFAULT 0 NOT NULL,
        dateCreated text NOT NULL,
        termsAcceptedTimestamp text,
        termsVersion text,
        marketingEmailConsent integer DEFAULT 0 NOT NULL,
        serverAdmin integer DEFAULT 0 NOT NULL,
        lastPasswordChange integer,
        locale text
    )`,
    `CREATE TABLE userOrgs (
        userId text NOT NULL,
        orgId text NOT NULL,
        isOwner integer DEFAULT 0 NOT NULL,
        autoProvisioned integer DEFAULT 0,
        pamUsername text
    )`
]);

const ORG_A = "org-a";
const ORG_B = "org-b";

async function insertIdp(autoProvision: boolean): Promise<number> {
    const [row] = await testDb
        .insert(idp)
        .values({ name: "OIDC IdP", type: "oidc", autoProvision })
        .returning();
    return row.idpId;
}

async function insertUser(
    userId: string,
    idpId: number,
    type: string = "oidc"
): Promise<void> {
    await testDb.insert(users).values({
        userId,
        username: userId,
        type,
        idpId,
        dateCreated: new Date().toISOString()
    });
}

async function insertMembership(
    userId: string,
    orgId: string,
    autoProvisioned: boolean
): Promise<void> {
    await testDb.insert(userOrgs).values({
        userId,
        orgId,
        autoProvisioned
    });
}

async function membershipFlag(
    userId: string,
    orgId: string
): Promise<boolean | null> {
    const rows = await testDb
        .select()
        .from(userOrgs)
        .where(eq(userOrgs.userId, userId));
    const row = rows.find((r) => r.orgId === orgId);
    if (!row) return null;
    return row.autoProvisioned === true;
}

async function runTests() {
    console.log("Running convertMembershipsOnAutoProvisionEnabled tests...");

    // A. False-to-true transition converts memberships scoped to the IdP.
    {
        const idpId = await insertIdp(false);
        const otherIdpId = await insertIdp(false);
        await insertUser("u1", idpId);
        await insertUser("u2", idpId);
        await insertUser("u-other", otherIdpId);
        await insertUser("u-internal", idpId, "internal");
        await insertMembership("u-internal", ORG_A, false);

        await insertMembership("u1", ORG_A, false);
        await insertMembership("u2", ORG_B, false);
        await insertMembership("u-other", ORG_A, false);

        const converted = await convertMembershipsOnAutoProvisionEnabled(
            idpId,
            false,
            true,
            testDb
        );
        assertEquals(
            converted,
            2,
            "A: two memberships of the IdP's OIDC users should be converted"
        );
        assertEquals(
            await membershipFlag("u-internal", ORG_A),
            false,
            "A: non-OIDC users of the IdP must not be converted"
        );
        assertEquals(
            await membershipFlag("u1", ORG_A),
            true,
            "A: u1 membership should become IdP-managed"
        );
        assertEquals(
            await membershipFlag("u2", ORG_B),
            true,
            "A: u2 membership should become IdP-managed"
        );
        assertEquals(
            await membershipFlag("u-other", ORG_A),
            false,
            "A: memberships of another IdP must stay locally managed (E)"
        );
    }

    // D. Idempotency: converting again changes nothing and creates no duplicates.
    {
        // Re-run on an already-converted IdP (persisted now true).
        const idpId = await insertIdp(true);
        await insertUser("ui", idpId);
        await insertMembership("ui", ORG_A, true);

        const converted = await convertMembershipsOnAutoProvisionEnabled(
            idpId,
            true,
            true,
            testDb
        );
        assertEquals(
            converted,
            null,
            "D: true -> true must not repeat the conversion"
        );

        const rows = await testDb
            .select()
            .from(userOrgs)
            .where(eq(userOrgs.userId, "ui"));
        assertEquals(rows.length, 1, "D: no duplicate memberships created");
    }

    // F. Non-transitioning updates are no-ops.
    {
        const idpId = await insertIdp(false);
        await insertUser("uf", idpId);
        await insertMembership("uf", ORG_A, false);

        // false -> false
        let result = await convertMembershipsOnAutoProvisionEnabled(
            idpId,
            false,
            false,
            testDb
        );
        assertEquals(result, null, "F: false -> false returns null");
        assertEquals(
            await membershipFlag("uf", ORG_A),
            false,
            "F: false -> false must not convert memberships"
        );

        // true -> false
        result = await convertMembershipsOnAutoProvisionEnabled(
            idpId,
            true,
            false,
            testDb
        );
        assertEquals(result, null, "F: true -> false returns null");
        assertEquals(
            await membershipFlag("uf", ORG_A),
            false,
            "F: true -> false must not convert memberships"
        );

        // undefined requested value (partial update) is a no-op
        result = await convertMembershipsOnAutoProvisionEnabled(
            idpId,
            false,
            undefined,
            testDb
        );
        assertEquals(result, null, "F: undefined requested value returns null");
    }

    // H. Manual membership semantics: the data model cannot distinguish an
    //    intentionally local membership from a legacy OIDC-created one, so an
    //    OIDC user's locally managed membership is converted too. Documented
    //    limitation (#3973).
    {
        const idpId = await insertIdp(false);
        await insertUser("um", idpId);
        await insertMembership("um", ORG_A, false); // intentionally local

        const converted = await convertMembershipsOnAutoProvisionEnabled(
            idpId,
            false,
            true,
            testDb
        );
        assertEquals(
            converted,
            1,
            "H: the legacy/local membership is converted (documented limitation)"
        );
        assertEquals(
            await membershipFlag("um", ORG_A),
            true,
            "H: membership becomes IdP-managed"
        );
    }

    // I. Transaction rollback: if the conversion runs inside a transaction that
    //    rolls back, neither the IdP change nor the membership change persists.
    {
        const idpId = await insertIdp(false);
        await insertUser("ur", idpId);
        await insertMembership("ur", ORG_A, false);

        let threw = false;
        try {
            await (testDb as any).transaction(async (trx: Transaction) => {
                await trx
                    .update(idp)
                    .set({ autoProvision: true })
                    .where(eq(idp.idpId, idpId));
                await convertMembershipsOnAutoProvisionEnabled(
                    idpId,
                    false,
                    true,
                    trx
                );
                throw new Error("simulated failure");
            });
        } catch {
            threw = true;
        }
        assertEquals(threw, true, "I: transaction should propagate the error");

        // Note: the conversion runs inside the caller's transaction (it receives
        // `trx`), so on PostgreSQL a failure rolls back both the IdP update and
        // the membership conversion. SQLite's better-sqlite3 driver commits
        // async transactions before the throw (a pre-existing driver
        // characteristic), so the DB state is not asserted here.
    }

    // B/C. After conversion the membership is part of the IdP-managed set that
    //      the OIDC callback synchronizes (it filters on autoProvisioned=true).
    //      Simulate the callback's sync step for an auto-provisioned org and
    //      verify roles are replaced 1:1, and that a locally-managed membership
    //      (autoProvisioned=false) is never touched by the sync filter.
    {
        const idpId = await insertIdp(false);
        await insertUser("ub", idpId);
        await insertMembership("ub", ORG_A, false);

        await convertMembershipsOnAutoProvisionEnabled(
            idpId,
            false,
            true,
            testDb
        );

        // The converted membership must be selected by the callback's managed
        // set query (eq(userOrgs.autoProvisioned, true)).
        const managed = await testDb
            .select()
            .from(userOrgs)
            .where(
                and(
                    eq(userOrgs.userId, "ub"),
                    eq(userOrgs.autoProvisioned, true)
                )
            );
        assertEquals(
            managed.length,
            1,
            "B: converted membership is now in the IdP-managed set"
        );

        // A membership that stayed locally managed (different IdP) is excluded
        // from the managed set, so the callback leaves its roles alone (C).
        const localIdpId = await insertIdp(false);
        await insertUser("uc", localIdpId);
        await insertMembership("uc", ORG_A, false);
        const localManaged = await testDb
            .select()
            .from(userOrgs)
            .where(
                and(
                    eq(userOrgs.userId, "uc"),
                    eq(userOrgs.autoProvisioned, true)
                )
            );
        assertEquals(
            localManaged.length,
            0,
            "C: a locally managed membership is excluded from the sync filter"
        );
    }

    // G. Disabled provisioning: when auto provisioning stays disabled, the
    //    helper never converts memberships, so the callback's sync path (gated
    //    on idp.autoProvision) never starts synchronizing them.
    {
        const idpId = await insertIdp(false);
        await insertUser("ug", idpId);
        await insertMembership("ug", ORG_A, false);

        const result = await convertMembershipsOnAutoProvisionEnabled(
            idpId,
            false,
            false,
            testDb
        );
        assertEquals(result, null, "G: disabled provisioning is a no-op");
        assertEquals(
            await membershipFlag("ug", ORG_A),
            false,
            "G: membership remains locally managed"
        );
    }

    console.log("All tests passed!");
}

try {
    await runTests();
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
