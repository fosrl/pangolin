import { eq } from "drizzle-orm";
import { userOrgRoles, userOrgs } from "@server/db";
import { assignUserToOrg } from "./userOrg";
import { assertEquals } from "@test/assert";
import { createTestDb } from "@test/testDb";
import type { Org } from "@server/db";

const orgId = "test-org";
const userId = "test-user";

const testDb = createTestDb([
    `CREATE TABLE userOrgs (
        userId text NOT NULL,
        orgId text NOT NULL,
        isOwner integer DEFAULT false NOT NULL,
        autoProvisioned integer DEFAULT false,
        pamUsername text
    )`,
    `CREATE TABLE userOrgRoles (
        userId text NOT NULL,
        orgId text NOT NULL,
        roleId integer NOT NULL,
        PRIMARY KEY (userId, orgId, roleId)
    )`
]);

const testOrg = {
    orgId: orgId,
    name: "Test Org"
} as unknown as Org;

async function getMemberships() {
    return await testDb
        .select()
        .from(userOrgs)
        .where(eq(userOrgs.orgId, orgId));
}

async function getRoles() {
    return await testDb
        .select()
        .from(userOrgRoles)
        .where(eq(userOrgRoles.orgId, orgId));
}

async function runTests() {
    console.log("Running assignUserToOrg tests...");

    // adding a user to an org creates the membership and the role
    await assignUserToOrg(
        testOrg,
        { userId: userId, orgId: orgId },
        [1],
        testDb
    );

    let memberships = await getMemberships();
    assertEquals(
        memberships.length,
        1,
        "The user should have been added to the org"
    );
    assertEquals(
        memberships[0].userId,
        userId,
        "The membership should belong to the user"
    );

    let roles = await getRoles();
    assertEquals(roles.length, 1, "The user should have one role in the org");
    assertEquals(roles[0].roleId, 1, "The user should have the admin role");

    // adding the same user to the same org again must not create a second
    // membership, that would show the user twice in the member list
    await assignUserToOrg(
        testOrg,
        { userId: userId, orgId: orgId },
        [1],
        testDb
    );

    memberships = await getMemberships();
    assertEquals(
        memberships.length,
        1,
        "The user should only be a member of the org once"
    );

    roles = await getRoles();
    assertEquals(roles.length, 1, "The role should not be added a second time");

    // a new role is added to the existing membership
    await assignUserToOrg(
        testOrg,
        { userId: userId, orgId: orgId },
        [1, 2],
        testDb
    );

    memberships = await getMemberships();
    assertEquals(
        memberships.length,
        1,
        "The user should only be a member of the org once"
    );

    roles = await getRoles();
    assertEquals(roles.length, 2, "The missing role should have been added");

    // the owner flag of an existing membership is kept
    await assignUserToOrg(
        testOrg,
        { userId: userId, orgId: orgId, isOwner: true },
        [1],
        testDb
    );

    memberships = await getMemberships();
    assertEquals(
        memberships.length,
        1,
        "The user should only be a member of the org once"
    );
    assertEquals(
        memberships[0].isOwner,
        true,
        "The membership should be the owner membership"
    );

    console.log("All tests passed!");
}

try {
    await runTests();
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
