import { evaluateMappings, normalizeRoleMappingResult } from "./idpMappingEval";
import { compileRoleMappingExpression } from "./idpRoleMapping";
import { assertEquals, assertEqualsObj } from "@test/assert";

const claims = {
    email: "jane@example.com",
    groups: ["admins", "eng"],
    org: "acme"
};

function testOrgMapping() {
    console.log("Running org mapping tests...");

    const run = (orgMapping: string | null, orgId = "acme") =>
        evaluateMappings({ claims, orgId, orgMapping, roleMapping: null })
            .orgMapping;

    assertEquals(run(null), null, "No org mapping must evaluate to null");
    assertEquals(
        run("contains(groups, 'eng')")?.passed,
        true,
        "An org mapping returning true must pass"
    );
    assertEquals(
        run("org")?.passed,
        true,
        "An org mapping returning the orgId must pass"
    );
    assertEquals(
        run("'{{orgId}}'")?.expression,
        "'acme'",
        "{{orgId}} must be replaced"
    );
    assertEquals(
        run("org", "other")?.passed,
        false,
        "An org mapping returning another org must fail"
    );
    const invalid = run("groups[");
    assertEquals(invalid?.passed, false, "An invalid org mapping must fail");
    assertEquals(
        typeof invalid?.error,
        "string",
        "An invalid org mapping must return its error instead of throwing"
    );
}

function testRoleMapping() {
    console.log("Running role mapping tests...");

    const run = (roleMapping: string) =>
        evaluateMappings({
            claims,
            orgId: "acme",
            orgMapping: null,
            roleMapping
        }).roleMapping;

    assertEqualsObj(run("'Member'")?.roleNames, ["Member"], "String result");
    assertEqualsObj(
        run("groups")?.roleNames,
        ["admins", "eng"],
        "Array result"
    );
    assertEqualsObj(run("email == 'x'")?.roleNames, [], "Non-string result");
    assertEqualsObj(
        run("groups")?.result,
        ["admins", "eng"],
        "The raw result must be kept"
    );
    assertEquals(
        typeof run("groups[")?.error,
        "string",
        "An invalid role mapping must return its error instead of throwing"
    );

    const builder = compileRoleMappingExpression({
        mode: "mappingBuilder",
        fixedRoleNames: [],
        mappingBuilder: {
            claimPath: "groups",
            rules: [{ matchValue: "admins", roleNames: ["Admin"] }]
        },
        rawExpression: ""
    });
    assertEqualsObj(
        run(builder)?.roleNames,
        ["Admin"],
        "A mapping builder value must be unwrapped before evaluation"
    );
}

function testNormalize() {
    console.log("Running normalizeRoleMappingResult tests...");
    assertEqualsObj(
        normalizeRoleMappingResult([" a ", "a", 1, "", "b"]),
        ["a", "b"],
        "Arrays must be trimmed, de-duplicated and keep only strings"
    );
}

function main() {
    testOrgMapping();
    testRoleMapping();
    testNormalize();
    console.log("All idp mapping evaluation tests passed");
}

main();
