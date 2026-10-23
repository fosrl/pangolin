import { eq } from "drizzle-orm";
import { users } from "@server/db";
import { setServerAdminCredentials } from "./setAdminCredentials";
import { assertEquals } from "@test/assert";
import { createTestDb } from "@test/testDb";

const password = "Password123!";

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
    )`
]);

async function getUsers() {
    return await testDb.select().from(users);
}

async function getAdmins() {
    return await testDb.select().from(users).where(eq(users.serverAdmin, true));
}

async function runTests() {
    console.log("Running setServerAdminCredentials tests...");

    // the first run creates the server admin
    const created = await setServerAdminCredentials(
        "admin@example.com",
        password,
        testDb
    );

    assertEquals(created.created, true, "The server admin should be created");
    assertEquals(
        created.userId,
        created.userId,
        "The server admin should have a user id"
    );

    let allUsers = await getUsers();
    assertEquals(allUsers.length, 1, "There should only be one user");
    assertEquals(
        allUsers[0].email,
        "admin@example.com",
        "The user should use the admin email address"
    );
    assertEquals(
        allUsers[0].serverAdmin,
        true,
        "The user should be the server admin"
    );

    // setting the credentials of another email address must not create a
    // second user, the current admin is updated instead
    const updated = await setServerAdminCredentials(
        "admin1@example.com",
        password,
        testDb
    );

    assertEquals(updated.created, false, "No new user should be created");
    assertEquals(
        updated.userId,
        created.userId,
        "The same account should be used for the new email address"
    );
    assertEquals(
        updated.emailChanged,
        true,
        "The email address of the admin should be updated"
    );

    allUsers = await getUsers();
    assertEquals(
        allUsers.length,
        1,
        "There should still only be one user"
    );
    assertEquals(
        allUsers[0].email,
        "admin1@example.com",
        "The user should use the new email address"
    );

    // setting the credentials back must restore the original admin
    const restored = await setServerAdminCredentials(
        "admin@example.com",
        password,
        testDb
    );

    assertEquals(
        restored.userId,
        created.userId,
        "The original admin should be restored"
    );

    allUsers = await getUsers();
    assertEquals(
        allUsers.length,
        1,
        "There should still only be one user"
    );
    assertEquals(
        allUsers[0].email,
        "admin@example.com",
        "The user should use the original email address"
    );

    // an account that already uses the email address becomes the admin
    // instead of creating a second account with the same email address
    await testDb.insert(users).values({
        userId: "other-user",
        email: "other@example.com",
        username: "other@example.com",
        type: "internal",
        dateCreated: new Date().toISOString(),
        serverAdmin: false,
        emailVerified: true
    });

    const promoted = await setServerAdminCredentials(
        "other@example.com",
        password,
        testDb
    );

    assertEquals(
        promoted.userId,
        "other-user",
        "The account with the email address should become the admin"
    );
    assertEquals(
        promoted.demotedAdminIds.length,
        1,
        "The other server admin should be demoted"
    );

    allUsers = await getUsers();
    assertEquals(
        allUsers.length,
        2,
        "There should not be a duplicate account"
    );

    const admins = await getAdmins();
    assertEquals(
        admins.length,
        1,
        "There should only be one server admin"
    );
    assertEquals(
        admins[0].email,
        "other@example.com",
        "The account with the email address should be the server admin"
    );

    console.log("All tests passed!");
}

try {
    await runTests();
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
