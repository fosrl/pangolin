import { assertEquals } from "@test/assert";
import {
    outboundAddressBlockReason,
    outboundHostBlockReason
} from "./outboundAddress";

const selfHosted = { allowPrivate: true, reservedHostnames: ["pangolin"] };
const saas = { allowPrivate: false, reservedHostnames: ["pangolin"] };

function testAddresses() {
    console.log("Running outbound address tests...");
    const alwaysBlocked = [
        "127.0.0.1",
        "::1",
        "0.0.0.0",
        "::",
        "169.254.169.254",
        "fe80::1",
        "::ffff:169.254.169.254",
        "::ffff:127.0.0.1",
        "224.0.0.1",
        "255.255.255.255"
    ];
    for (const a of alwaysBlocked) {
        assertEquals(
            outboundAddressBlockReason(a, selfHosted) !== null,
            true,
            `${a} blocked self-hosted`
        );
        assertEquals(
            outboundAddressBlockReason(a, saas) !== null,
            true,
            `${a} blocked saas`
        );
    }
    const privateAddrs = [
        "10.0.0.1",
        "172.17.0.1",
        "192.168.1.5",
        "fd00::1",
        "100.89.0.1"
    ];
    for (const a of privateAddrs) {
        assertEquals(
            outboundAddressBlockReason(a, selfHosted),
            null,
            `${a} allowed self-hosted`
        );
        assertEquals(
            outboundAddressBlockReason(a, saas) !== null,
            true,
            `${a} blocked saas`
        );
    }
    for (const a of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) {
        assertEquals(outboundAddressBlockReason(a, saas), null, `${a} allowed`);
    }
}

function testHosts() {
    console.log("Running outbound host tests...");
    for (const h of [
        "localhost",
        "a.localhost",
        "pangolin",
        "api.pangolin",
        "PANGOLIN.",
        "127.0.0.1",
        "[::1]",
        "2130706433"
    ]) {
        assertEquals(
            outboundHostBlockReason(h, selfHosted) !== null,
            true,
            `${h} blocked`
        );
    }
    for (const h of [
        "api.openai.com",
        "ollama",
        "pangolin.net",
        "my-pangolin"
    ]) {
        assertEquals(
            outboundHostBlockReason(h, selfHosted),
            null,
            `${h} allowed before DNS`
        );
    }
}

try {
    testAddresses();
    testHosts();
    console.log("All outbound address tests passed!");
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
