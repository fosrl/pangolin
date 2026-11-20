import {
    isLoginDenied,
    planMembershipChanges,
    type DesiredMembership
} from "./membershipChanges";
import { assertEquals, assertEqualsObj } from "@test/assert";

const desiredA: DesiredMembership = {
    orgId: "a",
    roleIds: [1],
    missingRoleNames: []
};

function testIsLoginDenied() {
    console.log("Running isLoginDenied tests...");

    assertEquals(
        isLoginDenied({
            currentMemberships: null,
            desired: [desiredA],
            candidateOrgIds: new Set(["a"])
        }),
        false,
        "A matched policy must let the user in"
    );
    assertEquals(
        isLoginDenied({
            currentMemberships: null,
            desired: [],
            candidateOrgIds: new Set(["a"])
        }),
        true,
        "A new user matching no policy must be refused"
    );
    assertEquals(
        isLoginDenied({
            currentMemberships: [{ orgId: "b", autoManaged: false }],
            desired: [],
            candidateOrgIds: new Set(["a"])
        }),
        false,
        "A manual membership must let the user in"
    );
    assertEquals(
        isLoginDenied({
            currentMemberships: [{ orgId: "b", autoManaged: true }],
            desired: [],
            candidateOrgIds: new Set(["a"])
        }),
        false,
        "An auto-managed membership outside the candidate orgs must let the user in"
    );
    assertEquals(
        isLoginDenied({
            currentMemberships: [{ orgId: "a", autoManaged: true }],
            desired: [],
            candidateOrgIds: new Set(["a"])
        }),
        true,
        "Only stale auto-managed memberships in candidate orgs must refuse the login"
    );
    assertEquals(
        isLoginDenied({
            currentMemberships: [{ orgId: "b", autoManaged: null }],
            desired: [],
            candidateOrgIds: new Set(["a"])
        }),
        true,
        "A legacy membership (autoManaged null) must not count as manual"
    );
}

function testPlanMembershipChanges() {
    console.log("Running planMembershipChanges tests...");

    const changes = planMembershipChanges({
        currentMemberships: [
            { orgId: "a", autoManaged: true, roleIds: [9] },
            { orgId: "b", autoManaged: true },
            { orgId: "c", autoManaged: false },
            { orgId: "d", autoManaged: true }
        ],
        desired: [
            desiredA,
            { orgId: "c", roleIds: [3], missingRoleNames: [] },
            { orgId: "e", roleIds: [], missingRoleNames: ["New"] }
        ],
        candidateOrgIds: new Set(["a", "b", "c", "e"])
    });

    assertEqualsObj(
        changes.add.map((a) => a.orgId),
        ["e"],
        "Only orgs the user isn't a member of must be added"
    );
    assertEqualsObj(
        changes.remove,
        ["b"],
        "Stale auto-managed memberships in candidate orgs must be removed, others kept"
    );
    assertEqualsObj(
        changes.updateRoles.map((u) => [u.orgId, u.roleIds, u.previousRoleIds]),
        [["a", [1], [9]]],
        "Auto-managed memberships that still match must get the mapped roles"
    );
    assertEqualsObj(
        changes.keptManual,
        ["c"],
        "Manual memberships that match must be left untouched"
    );
}

function main() {
    testIsLoginDenied();
    testPlanMembershipChanges();
    console.log("All membership changes tests passed");
}

main();
