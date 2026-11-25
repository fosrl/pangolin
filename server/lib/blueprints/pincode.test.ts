import "@server/extendZod";
import { assertEquals } from "@test/assert";
import { convertValue, setNestedProperty } from "./parseDotNotation";
import { processContainerLabels } from "./parseDockerContainers";
import { AuthSchema, ResourcePolicySchema } from "./types";

function testResourcePincode() {
    console.log("Running resource blueprint pincode test...");
    assertEquals(
        AuthSchema.parse({ pincode: "012345" }).pincode,
        "012345",
        "a PIN with a leading zero is accepted as a string"
    );
    assertEquals(
        AuthSchema.parse({ pincode: 123456 }).pincode,
        "123456",
        "a numeric PIN is still accepted"
    );
    for (const pincode of ["12345", "1234567", "12a456", 12345, 1234567]) {
        assertEquals(
            AuthSchema.safeParse({ pincode }).success,
            false,
            `${JSON.stringify(pincode)} is not a 6-digit PIN`
        );
    }
}

function testResourcePolicyPincode() {
    console.log("Running resource policy blueprint pincode test...");
    for (const [pincode, expected] of [
        ["012345", "012345"],
        [123456, "123456"]
    ] as const) {
        const parsed = ResourcePolicySchema.safeParse({
            name: "policy",
            pincode
        });
        assertEquals(
            parsed.success && parsed.data.pincode,
            expected,
            `policy pincode ${JSON.stringify(pincode)} is accepted`
        );
    }
}

function testDockerLabelPincode() {
    console.log("Running Docker label pincode test...");
    assertEquals(convertValue("012345"), "012345", "leading zeros survive");
    assertEquals(convertValue("123456"), 123456, "plain numbers convert");
    assertEquals(convertValue("0"), 0, "zero converts");

    const labels: any = {};
    setNestedProperty(labels, "resources.app.auth.pincode", "012345");
    assertEquals(
        AuthSchema.parse(labels.resources.app.auth).pincode,
        "012345",
        "a leading-zero PIN from a Docker label round-trips"
    );
}

function testDockerLabelPrototypePollution() {
    console.log("Running Docker label prototype pollution test...");
    const bad = [
        "resources.__proto__.userOrg.userId",
        "resources.app.__proto__.polluted",
        "resources.constructor.prototype.polluted",
        "resources.app.constructor.prototype.polluted",
        "resources.app.prototype.polluted",
        "resources.__proto__[0].polluted",
        "resources.app.targets[0].__proto__",
        "resources.app.__proto__[0]",
        "__proto__.polluted"
    ];
    for (const path of bad) {
        const labels: any = Object.create(null);
        assertEquals(
            setNestedProperty(labels, path, "x"),
            false,
            `${path} is rejected`
        );
        assertEquals(
            Object.keys(labels).length,
            0,
            `${path} leaves the object untouched`
        );
    }
    assertEquals(
        ({} as any).userOrg,
        undefined,
        "Object.prototype.userOrg is not set"
    );
    assertEquals(
        ({} as any).polluted,
        undefined,
        "Object.prototype.polluted is not set"
    );

    // End to end through the container parser, on a plain {} root
    const result = processContainerLabels([
        {
            id: "1",
            name: "evil",
            image: "x",
            state: "running",
            status: "",
            ports: null,
            created: 0,
            networks: {},
            hostname: "h",
            labels: {
                "pangolin.proxy-resources.__proto__.userOrg.userId": "victim",
                "pangolin.proxy-resources.app.__proto__.actionIds": "1",
                "pangolin.proxy-resources.app.name": "ok"
            }
        }
    ] as any);
    assertEquals(({} as any).userOrg, undefined, "no pollution via parser");
    assertEquals(({} as any).actionIds, undefined, "no pollution via parser");
    assertEquals(
        result["proxy-resources"].app.name,
        "ok",
        "valid labels in the same container still apply"
    );

    // Non-object labels from the websocket message are skipped
    processContainerLabels([
        { state: "running", labels: "nope" },
        { state: "running", labels: null },
        null
    ] as any);
}

try {
    testResourcePincode();
    testResourcePolicyPincode();
    testDockerLabelPincode();
    testDockerLabelPrototypePollution();
    console.log("All blueprint pincode tests passed!");
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
