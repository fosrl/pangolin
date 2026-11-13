import "@server/extendZod";
import { assertEquals } from "@test/assert";
import { convertValue, setNestedProperty } from "./parseDotNotation";
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

try {
    testResourcePincode();
    testResourcePolicyPincode();
    testDockerLabelPincode();
    console.log("All blueprint pincode tests passed!");
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
