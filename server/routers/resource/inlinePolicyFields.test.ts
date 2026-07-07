import { assertEquals } from "../../../test/assert";
import { applyInlinePolicyFields } from "./inlinePolicyFields";

function runTests() {
    const resource = {
        resourceId: 1,
        name: "dashboard",
        sso: null,
        emailWhitelistEnabled: null,
        applyRules: null,
        skipToIdpId: null
    } as any;

    const enabledPolicy = {
        sso: true,
        emailWhitelistEnabled: true,
        applyRules: true,
        idpId: 42
    };

    const enabledResult = applyInlinePolicyFields(resource, enabledPolicy);
    assertEquals(enabledResult.sso, true, "sso should mirror policy true");
    assertEquals(
        enabledResult.emailWhitelistEnabled,
        true,
        "email whitelist should mirror policy true"
    );
    assertEquals(
        enabledResult.applyRules,
        true,
        "applyRules should mirror policy true"
    );
    assertEquals(
        enabledResult.skipToIdpId,
        42,
        "skipToIdpId should use policy idpId"
    );

    const disabledPolicy = {
        sso: false,
        emailWhitelistEnabled: false,
        applyRules: false,
        idpId: null
    };

    const disabledResult = applyInlinePolicyFields(resource, disabledPolicy);
    assertEquals(disabledResult.sso, false, "sso false must not become null");
    assertEquals(
        disabledResult.emailWhitelistEnabled,
        false,
        "email whitelist false must not become null"
    );
    assertEquals(
        disabledResult.applyRules,
        false,
        "applyRules false must not become null"
    );
    assertEquals(
        disabledResult.skipToIdpId,
        null,
        "missing idp should stay null"
    );

    const missingPolicyResult = applyInlinePolicyFields(resource, null);
    assertEquals(
        missingPolicyResult.sso,
        null,
        "missing policy should return nullable resource fields"
    );

    console.log("PASS: inline policy fields mirror policy values");
}

runTests();
