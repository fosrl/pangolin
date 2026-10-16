import {
    aliasTargetsOnly,
    cidrToRange,
    findNextAvailableCidr,
    type SubnetProxyTargetV2
} from "./ip";
import { assertEquals } from "@test/assert";

// Test cases
function testFindNextAvailableCidr() {
    console.log("Running findNextAvailableCidr tests...");

    // Test 0: Basic IPv4 allocation with a subnet in the wrong range
    {
        const existing = ["100.90.130.1/30", "100.90.128.4/30"];
        const result = findNextAvailableCidr(existing, 30, "100.90.130.1/24");
        assertEquals(result, "100.90.130.4/30", "Basic IPv4 allocation failed");
    }

    // Test 1: Basic IPv4 allocation
    {
        const existing = ["10.0.0.0/16", "10.1.0.0/16"];
        const result = findNextAvailableCidr(existing, 16, "10.0.0.0/8");
        assertEquals(result, "10.2.0.0/16", "Basic IPv4 allocation failed");
    }

    // Test 2: Finding gap between allocations
    {
        const existing = ["10.0.0.0/16", "10.2.0.0/16"];
        const result = findNextAvailableCidr(existing, 16, "10.0.0.0/8");
        assertEquals(
            result,
            "10.1.0.0/16",
            "Finding gap between allocations failed"
        );
    }

    // Test 3: No available space
    {
        const existing = ["10.0.0.0/8"];
        const result = findNextAvailableCidr(existing, 8, "10.0.0.0/8");
        assertEquals(result, null, "No available space test failed");
    }

    // Test 4: Empty existing
    {
        const existing: string[] = [];
        const result = findNextAvailableCidr(existing, 30, "10.0.0.0/8");
        assertEquals(result, "10.0.0.0/30", "Empty existing test failed");
    }
    // // Test 4: IPv6 allocation
    // {
    //     const existing = ["2001:db8::/32", "2001:db8:1::/32"];
    //     const result = findNextAvailableCidr(existing, 32, "2001:db8::/16");
    //     assertEquals(result, "2001:db8:2::/32", "Basic IPv6 allocation failed");
    // }

    // // Test 5: Mixed IP versions
    // {
    //     const existing = ["10.0.0.0/16", "2001:db8::/32"];
    //     assertThrows(
    //         () => findNextAvailableCidr(existing, 16),
    //         "All CIDRs must be of the same IP version",
    //         "Mixed IP versions test failed"
    //     );
    // }

    // Test 6: Empty input
    {
        const existing: string[] = [];
        const result = findNextAvailableCidr(existing, 16);
        assertEquals(result, null, "Empty input test failed");
    }

    // Test 7: Block size alignment
    {
        const existing = ["10.0.0.0/24"];
        const result = findNextAvailableCidr(existing, 24, "10.0.0.0/16");
        assertEquals(result, "10.0.1.0/24", "Block size alignment test failed");
    }

    // Test 8: Block size alignment
    {
        const existing: string[] = [];
        const result = findNextAvailableCidr(existing, 24, "10.0.0.0/16");
        assertEquals(result, "10.0.0.0/24", "Block size alignment test failed");
    }

    // Test 9: Large block size request
    {
        const existing = ["10.0.0.0/24", "10.0.1.0/24"];
        const result = findNextAvailableCidr(existing, 16, "10.0.0.0/16");
        assertEquals(result, null, "Large block size request test failed");
    }

    console.log("All findNextAvailableCidr tests passed!");
}

// function testCidrToRange() {
//     console.log("Running cidrToRange tests...");

//     // Test 1: Basic IPv4 conversion
//     {
//         const result = cidrToRange("192.168.0.0/24");
//         assertEqualsObj(result, {
//             start: BigInt("3232235520"),
//             end: BigInt("3232235775")
//         }, "Basic IPv4 conversion failed");
//     }

//     // Test 2: IPv6 conversion
//     {
//         const result = cidrToRange("2001:db8::/32");
//         assertEqualsObj(result, {
//             start: BigInt("42540766411282592856903984951653826560"),
//             end: BigInt("42540766411282592875350729025363378175")
//         }, "IPv6 conversion failed");
//     }

//     // Test 3: Invalid prefix length
//     {
//         assertThrows(
//             () => cidrToRange("192.168.0.0/33"),
//             "Invalid prefix length for IPv4",
//             "Invalid IPv4 prefix test failed"
//         );
//     }

//     // Test 4: Invalid IPv6 prefix
//     {
//         assertThrows(
//             () => cidrToRange("2001:db8::/129"),
//             "Invalid prefix length for IPv6",
//             "Invalid IPv6 prefix test failed"
//         );
//     }

//     console.log("All cidrToRange tests passed!");
// }

function testAliasTargetsOnly() {
    console.log("Running aliasTargetsOnly tests...");

    // A host mode resource generates a destination target
    // (no rewriteTo) plus one for its alias address.
    const destinationTarget: SubnetProxyTargetV2 = {
        sourcePrefixes: [],
        destPrefix: "192.168.0.119/32",
        disableIcmp: false,
        resourceId: 1
    };
    const aliasTarget: SubnetProxyTargetV2 = {
        sourcePrefixes: [],
        destPrefix: "100.96.128.8/32",
        rewriteTo: "192.168.0.119/32",
        disableIcmp: false,
        resourceId: 1
    };

    // Only the alias target may be removed while another
    // resource still serves the same destination.
    {
        const result = aliasTargetsOnly([destinationTarget, aliasTarget]);
        assertEquals(result.length, 1, "Only the alias target should remain");
        assertEquals(
            result[0].destPrefix,
            "100.96.128.8/32",
            "The alias target should be the one kept"
        );
    }

    // A resource without an alias has nothing unique to remove.
    {
        const result = aliasTargetsOnly([destinationTarget]);
        assertEquals(
            result.length,
            0,
            "A destination target alone must not be removed"
        );
    }

    // cidr mode resources only produce destination targets,
    // so nothing is removed while the destination is shared.
    {
        const cidrTarget: SubnetProxyTargetV2 = {
            sourcePrefixes: [],
            destPrefix: "192.168.0.0/24",
            disableIcmp: false,
            resourceId: 2
        };
        const result = aliasTargetsOnly([cidrTarget]);
        assertEquals(result.length, 0, "A cidr target should be dropped");
    }

    // Every alias of the resource is unique to it.
    {
        const secondAliasTarget: SubnetProxyTargetV2 = {
            sourcePrefixes: [],
            destPrefix: "100.96.128.9/32",
            rewriteTo: "192.168.0.119/32",
            disableIcmp: false,
            resourceId: 1
        };
        const result = aliasTargetsOnly([
            destinationTarget,
            aliasTarget,
            secondAliasTarget
        ]);
        assertEquals(result.length, 2, "Both alias targets should remain");
    }

    // Empty input stays empty.
    {
        const result = aliasTargetsOnly([]);
        assertEquals(result.length, 0, "Empty input should stay empty");
    }

    console.log("All aliasTargetsOnly tests passed!");
}

// Run all tests
try {
    // testCidrToRange();
    testFindNextAvailableCidr();
    testAliasTargetsOnly();
    console.log("All tests passed successfully!");
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
