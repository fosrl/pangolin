import { assertEquals } from "@test/assert";
import { localSiteTargetError } from "./localSiteTargets";

function testLocalSiteTargets() {
    console.log("Running localSiteTargetError tests...");
    const blocked = [
        "127.0.0.1",
        "127.1.2.3",
        "localhost",
        "LOCALHOST",
        "foo.localhost",
        "pangolin",
        "pangolin.",
        "gerbil",
        "traefik",
        "0.0.0.0",
        "::1",
        "[::1]",
        "::",
        "::ffff:127.0.0.1",
        "169.254.169.254",
        "fe80::1",
        "2130706433",
        "0x7f000001"
    ];
    for (const t of blocked) {
        assertEquals(localSiteTargetError(t) !== null, true, `${t} is blocked`);
    }
    const allowed = [
        "10.0.0.5",
        "192.168.1.20",
        "172.18.0.4",
        "myapp",
        "grafana.internal",
        "example.com",
        "8.8.8.8",
        "pangolin-docs",
        "fd00::5"
    ];
    for (const t of allowed) {
        assertEquals(localSiteTargetError(t), null, `${t} is allowed`);
    }
}

try {
    testLocalSiteTargets();
    console.log("All localSiteTargetError tests passed!");
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
