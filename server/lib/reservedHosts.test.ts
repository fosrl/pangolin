import { assertEquals } from "@test/assert";
import { hostCovers } from "./reservedHosts";

function testHostCovers() {
    console.log("Running hostCovers tests...");
    const cases: [string, string, boolean][] = [
        ["app.example.com", "app.example.com", true],
        ["App.Example.com", "app.example.com", true],
        ["app.example.com", "other.example.com", false],
        ["*.example.com", "app.example.com", true],
        ["*.example.com", "example.com", false],
        ["*.example.com", "a.b.example.com", false],
        ["*.example.com", "app.example.org", false],
        ["*.example.com", "evilexample.com", false],
        ["*.app.example.com", "app.example.com", false]
    ];
    for (const [host, candidate, expected] of cases) {
        assertEquals(
            hostCovers(host, candidate),
            expected,
            `${host} covers ${candidate}`
        );
    }
}

try {
    testHostCovers();
    console.log("All reservedHosts tests passed!");
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
