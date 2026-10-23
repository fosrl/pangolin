import { eq } from "drizzle-orm";
import {
    passwordResetTokens,
    sessions,
    userInviteRoles,
    userInvites,
    userOrgRoles,
    userOrgs,
    users
} from "@server/db";
import { deleteUser } from "./deleteUser";
import { assertEquals } from "@test/assert";
import { createTestDb } from "@test/testDb";

const userId = "test-user";
const email = "test@example.com";

const testDb = createTestDb([
    `CREATE TABLE user (
        id text PRIMARY KEY NOT NULL,
        email text,
        username text NOT NULL,
        name text,
        type text NOT NULL,
        idpId integer,
        passwordHash text,
        twoFactorEnabled integer DEFAULT false NOT NULL,
        twoFactorSetupRequested integer DEFAULT false,
        twoFactorSecret text,
        emailVerified integer DEFAULT false NOT NULL,
        dateCreated text NOT NULL,
        termsAcceptedTimestamp text,
        termsVersion text,
        marketingEmailConsent integer DEFAULT false NOT NULL,
        serverAdmin integer DEFAULT false NOT NULL,
        lastPasswordChange integer,
        locale text
    )`,
    `CREATE TABLE session (
        id text PRIMARY KEY NOT NULL,
        userId text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        expiresAt integer NOT NULL,
        issuedAt integer,
        deviceAuthUsed integer DEFAULT false NOT NULL
    )`,
    `CREATE TABLE passwordResetTokens (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        email text NOT NULL,
        userId text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        tokenHash text NOT NULL,
        expiresAt integer NOT NULL
    )`,
    `CREATE TABLE userOrgs (
        userId text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        orgId text NOT NULL,
        isOwner integer DEFAULT false NOT NULL,
        autoProvisioned integer DEFAULT false,
        pamUsername text
    )`,
    `CREATE TABLE userOrgRoles (
        userId text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        orgId text NOT NULL,
        roleId integer NOT NULL
    )`,
    `CREATE TABLE userInvites (
        inviteId text PRIMARY KEY NOT NULL,
        orgId text NOT NULL,
        email text NOT NULL,
        expiresAt integer NOT NULL,
        token text NOT NULL
    )`,
    `CREATE TABLE userInviteRoles (
        inviteId text NOT NULL REFERENCES userInvites(inviteId) ON DELETE CASCADE,
        roleId integer NOT NULL
    )`
]);

async function countRows(table: any, column: any, value: string) {
    const rows = await testDb
        .select({ value: column })
        .from(table)
        .where(eq(column, value as never));
    return rows.length;
}

async function runTests() {
    console.log("Running deleteUser tests...");

    await testDb.insert(users).values({
        userId: userId,
        email: email,
        username: email,
        type: "internal",
        dateCreated: new Date().toISOString(),
        emailVerified: true
    });
    await testDb.insert(sessions).values({
        sessionId: "test-session",
        userId: userId,
        expiresAt: new Date().getTime() + 1000
    });
    await testDb.insert(passwordResetTokens).values({
        email: email,
        userId: userId,
        tokenHash: "test-hash",
        expiresAt: new Date().getTime() + 1000
    });
    await testDb.insert(userOrgs).values({
        userId: userId,
        orgId: "test-org"
    });
    await testDb.insert(userOrgRoles).values({
        userId: userId,
        orgId: "test-org",
        roleId: 1
    });
    await testDb.insert(userInvites).values({
        inviteId: "test-invite",
        orgId: "test-org",
        email: email,
        expiresAt: new Date().getTime() + 1000,
        tokenHash: "test-hash"
    });
    await testDb.insert(userInviteRoles).values({
        inviteId: "test-invite",
        roleId: 1
    });

    await deleteUser(userId, testDb);

    assertEquals(
        await countRows(users, users.userId, userId),
        0,
        "The user should have been deleted"
    );
    assertEquals(
        await countRows(sessions, sessions.userId, userId),
        0,
        "The sessions of the user should have been deleted"
    );
    assertEquals(
        await countRows(
            passwordResetTokens,
            passwordResetTokens.userId,
            userId
        ),
        0,
        "The password reset tokens of the user should have been deleted"
    );
    assertEquals(
        await countRows(userOrgs, userOrgs.userId, userId),
        0,
        "The org memberships of the user should have been deleted"
    );
    assertEquals(
        await countRows(userOrgRoles, userOrgRoles.userId, userId),
        0,
        "The org roles of the user should have been deleted"
    );

    // the invites are stored with the email address of the user
    const invites = await testDb
        .select()
        .from(userInvites)
        .where(eq(userInvites.email, email));
    assertEquals(
        invites.length,
        0,
        "The invites of the user should have been deleted"
    );

    const inviteRoles = await testDb
        .select()
        .from(userInviteRoles)
        .where(eq(userInviteRoles.inviteId, "test-invite"));
    assertEquals(
        inviteRoles.length,
        0,
        "The invite roles of the user should have been deleted"
    );

    console.log("All tests passed!");
}

try {
    await runTests();
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
