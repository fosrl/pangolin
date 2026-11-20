import { evaluateRoleMapping } from "./evaluateRoleMapping";
import { compileRoleMappingExpression } from "@app/lib/idpRoleMapping";
import { assertEqualsObj } from "@test/assert";

const claims = {
    email: "jane@example.com",
    groups: ["group-id-1", "group-id-2"],
    groupNames: ["Admins", "Engineering"]
};

function testFixedRoles() {
    console.log("Running fixed roles tests...");

    assertEqualsObj(
        evaluateRoleMapping("'Member'", claims),
        ["Member"],
        "A single quoted role must resolve to that role"
    );
    assertEqualsObj(
        evaluateRoleMapping("['Member', 'Admin']", claims),
        ["Member", "Admin"],
        "A quoted role array must resolve to every role"
    );
}

function testMappingBuilder() {
    console.log("Running mapping builder tests...");

    const stored = compileRoleMappingExpression({
        mode: "mappingBuilder",
        fixedRoleNames: [],
        mappingBuilder: {
            claimPath: "groupNames",
            rules: [
                { matchValue: "Admins", roleNames: ["Admin"] },
                { matchValue: "Engineering", roleNames: ["Member", "Admin"] },
                { matchValue: "Sales", roleNames: ["Sales"] }
            ]
        },
        rawExpression: ""
    });

    assertEqualsObj(
        evaluateRoleMapping(stored, claims),
        ["Admin", "Member"],
        "Builder rules must match on the claim path and dedupe roles"
    );
}

function testRawExpression() {
    console.log("Running raw expression tests...");

    assertEqualsObj(
        evaluateRoleMapping("groupNames", claims),
        ["Admins", "Engineering"],
        "A raw expression must return the claim values"
    );
    assertEqualsObj(
        evaluateRoleMapping("contains(groups, 'group-id-1') && 'Admin'", claims),
        ["Admin"],
        "A raw expression can return a single role"
    );
    assertEqualsObj(
        evaluateRoleMapping("missing", claims),
        [],
        "A missing claim must resolve to no roles"
    );
}

function testEmptyMapping() {
    console.log("Running empty mapping tests...");

    assertEqualsObj(
        evaluateRoleMapping(null, claims),
        [],
        "A null mapping must resolve to no roles"
    );
    assertEqualsObj(
        evaluateRoleMapping("  ", claims),
        [],
        "A blank mapping must resolve to no roles"
    );
}

// Run all tests
try {
    testFixedRoles();
    testMappingBuilder();
    testRawExpression();
    testEmptyMapping();
    console.log("All tests passed successfully!");
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
