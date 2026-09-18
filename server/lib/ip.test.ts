import { cidrToRange, findNextAvailableCidr } from "./ip";
import { assertEquals, assertThrows } from "@test/assert";

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
    // Test 4a: Basic IPv6 allocation (gap after two adjacent /48 blocks)
    {
        const existing = ["2001:db8::/48", "2001:db8:1::/48"];
        const result = findNextAvailableCidr(existing, 48, "2001:db8::/32");
        assertEquals(result, "2001:db8:2::/48", "Basic IPv6 allocation failed");
    }

    // Test 4b: IPv6 with no available space
    {
        const existing = ["2001:db8::/32"];
        const result = findNextAvailableCidr(existing, 32, "2001:db8::/32");
        assertEquals(result, null, "IPv6 no available space test failed");
    }

    // Test 5: Mixed IP versions
    {
        const existing = ["10.0.0.0/16", "2001:db8::/32"];
        assertThrows(
            () => findNextAvailableCidr(existing, 16),
            "All CIDRs must be of the same IP version",
            "Mixed IP versions test failed"
        );
    }

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

function testCidrToRange() {
    console.log("Running cidrToRange tests...");

    // Test 1: Basic IPv4 conversion
    {
        const result = cidrToRange("192.168.0.0/24");
        assertEquals(
            result.start,
            BigInt("3232235520"),
            "Basic IPv4 conversion start failed"
        );
        assertEquals(
            result.end,
            BigInt("3232235775"),
            "Basic IPv4 conversion end failed"
        );
    }

    // Test 2: IPv6 conversion
    {
        const result = cidrToRange("2001:db8::/32");
        // 2001:db8:: as a 128-bit integer (RFC 3849 documentation prefix)
        assertEquals(
            result.start,
            BigInt("42540766411282592856903984951653826560"),
            "IPv6 network address conversion failed"
        );
        // A /32 block spans 2^96 addresses
        assertEquals(
            result.end - result.start + BigInt(1),
            BigInt(1) << BigInt(96),
            "IPv6 /32 block size failed"
        );
    }

    // Test 3: Invalid prefix length
    {
        assertThrows(
            () => cidrToRange("192.168.0.0/33"),
            "Invalid prefix length for IPv4",
            "Invalid IPv4 prefix test failed"
        );
    }

    // Test 4: Invalid IPv6 prefix
    {
        assertThrows(
            () => cidrToRange("2001:db8::/129"),
            "Invalid prefix length for IPv6",
            "Invalid IPv6 prefix test failed"
        );
    }

    console.log("All cidrToRange tests passed!");
}

// Run all tests
try {
    testCidrToRange();
    testFindNextAvailableCidr();
    console.log("All tests passed successfully!");
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
