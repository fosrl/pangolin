import { assertEquals } from "@test/assert";
import {
    initRequestAuthState,
    ownApiKeyOrg,
    ownUserOrg
} from "./requestAuthState";

const proto = Object.prototype as any;

function withPollutedPrototype(fn: () => void) {
    proto.userOrg = { userId: "victim", orgId: "victim-org" };
    proto.apiKeyOrg = { apiKeyId: "victim-key", orgId: "victim-org" };
    proto.userOrgRoleIds = [1];
    proto.orgPolicyAllowed = true;
    try {
        fn();
    } finally {
        delete proto.userOrg;
        delete proto.apiKeyOrg;
        delete proto.userOrgRoleIds;
        delete proto.orgPolicyAllowed;
    }
}

function testInheritedValuesAreIgnored() {
    console.log("Running inherited auth state test...");
    withPollutedPrototype(() => {
        const req: any = {
            user: { userId: "victim" },
            apiKey: { apiKeyId: "victim-key" }
        };
        assertEquals(
            ownUserOrg(req),
            undefined,
            "inherited userOrg is ignored"
        );
        assertEquals(
            ownApiKeyOrg(req),
            undefined,
            "inherited apiKeyOrg is ignored"
        );

        initRequestAuthState(req);
        assertEquals(req.userOrg, undefined, "init shadows userOrg");
        assertEquals(req.apiKeyOrg, undefined, "init shadows apiKeyOrg");
        assertEquals(
            req.userOrgRoleIds,
            undefined,
            "init shadows userOrgRoleIds"
        );
        assertEquals(
            req.orgPolicyAllowed,
            undefined,
            "init shadows orgPolicyAllowed"
        );
    });
}

function testInitKeepsExistingValues() {
    console.log("Running init keeps own values test...");
    const userOrg = { userId: "u1", orgId: "o1" };
    const req: any = { user: { userId: "u1" }, userOrg };
    initRequestAuthState(req);
    assertEquals(req.userOrg, userOrg, "own value is kept");
}

function testOwnershipMustMatchCaller() {
    console.log("Running cached membership ownership test...");
    const userOrg = { userId: "u1", orgId: "o1" };
    assertEquals(
        ownUserOrg({ user: { userId: "u1" }, userOrg } as any),
        userOrg,
        "own userOrg for the caller is returned"
    );
    assertEquals(
        ownUserOrg({ user: { userId: "u2" }, userOrg } as any),
        undefined,
        "userOrg for another user is rejected"
    );
    assertEquals(
        ownUserOrg({ userOrg } as any),
        undefined,
        "userOrg without a signed-in user is rejected"
    );

    const apiKeyOrg = { apiKeyId: "k1", orgId: "o1" };
    assertEquals(
        ownApiKeyOrg({ apiKey: { apiKeyId: "k1" }, apiKeyOrg } as any),
        apiKeyOrg,
        "own apiKeyOrg for the caller is returned"
    );
    assertEquals(
        ownApiKeyOrg({ apiKey: { apiKeyId: "k2" }, apiKeyOrg } as any),
        undefined,
        "apiKeyOrg for another key is rejected"
    );
}

try {
    testInheritedValuesAreIgnored();
    testInitKeepsExistingValues();
    testOwnershipMustMatchCaller();
    console.log("All request auth state tests passed!");
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
