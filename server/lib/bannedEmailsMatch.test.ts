import { assertEquals } from "@test/assert";
import { bannedEmailCandidates } from "./bannedEmailsMatch";

function testCandidates() {
    console.log("Running bannedEmailCandidates tests...");
    const c = bannedEmailCandidates("Bad+Tag@Mail.Evil.example");
    for (const expected of [
        "bad+tag@mail.evil.example",
        "bad@mail.evil.example",
        "@mail.evil.example",
        "@evil.example"
    ]) {
        assertEquals(c.includes(expected), true, `includes ${expected}`);
    }
    assertEquals(c.includes("@example"), false, "never bans a whole TLD");
    assertEquals(
        bannedEmailCandidates("plain@euploading.com").sort().join(","),
        ["@euploading.com", "plain@euploading.com"].sort().join(","),
        "plain address"
    );
    assertEquals(
        bannedEmailCandidates("not-an-email").join(","),
        "not-an-email",
        "no domain"
    );
}

try {
    testCandidates();
    console.log("All bannedEmailCandidates tests passed!");
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
