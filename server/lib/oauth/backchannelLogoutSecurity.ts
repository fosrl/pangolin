import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const blockList = new BlockList();

// IPv4 reserved / private ranges
blockList.addSubnet("0.0.0.0",       8, "ipv4"); // "This" network
blockList.addSubnet("10.0.0.0",      8, "ipv4"); // Private (RFC 1918)
blockList.addSubnet("100.64.0.0",   10, "ipv4"); // Shared Address Space (CGNAT)
blockList.addSubnet("127.0.0.0",     8, "ipv4"); // Loopback
blockList.addSubnet("169.254.0.0",  16, "ipv4"); // Link-local
blockList.addSubnet("172.16.0.0",   12, "ipv4"); // Private (RFC 1918)
blockList.addSubnet("192.0.0.0",    24, "ipv4"); // IETF Protocol Assignments
blockList.addSubnet("192.0.2.0",    24, "ipv4"); // TEST-NET-1 (documentation)
blockList.addSubnet("192.88.99.0",  24, "ipv4"); // 6to4 Relay Anycast (deprecated)
blockList.addSubnet("192.168.0.0",  16, "ipv4"); // Private (RFC 1918)
blockList.addSubnet("198.18.0.0",   15, "ipv4"); // Benchmarking
blockList.addSubnet("198.51.100.0", 24, "ipv4"); // TEST-NET-2 (documentation)
blockList.addSubnet("203.0.113.0",  24, "ipv4"); // TEST-NET-3 (documentation)
blockList.addSubnet("224.0.0.0",     4, "ipv4"); // Multicast
blockList.addSubnet("240.0.0.0",     4, "ipv4"); // Reserved for future use

// IPv6 reserved / private ranges
blockList.addSubnet("::",          128, "ipv6"); // Unspecified
blockList.addSubnet("::1",         128, "ipv6"); // Loopback
blockList.addSubnet("fc00::",        7, "ipv6"); // Unique Local Addresses
blockList.addSubnet("fe80::",       10, "ipv6"); // Link-local
blockList.addSubnet("fec0::",       10, "ipv6"); // Site-local
blockList.addSubnet("ff00::",        8, "ipv6"); // Multicast
blockList.addSubnet("2001:db8::",   32, "ipv6"); // Documentation
blockList.addSubnet("2001:2::",     48, "ipv6"); // Benchmarking
blockList.addSubnet("100::",        64, "ipv6"); // Discard-Only

function normalizeHostname(hostname: string): string {
    const lower = hostname.trim().toLowerCase();
    return lower.endsWith(".") ? lower.slice(0, -1) : lower;
}

function validateBackchannelLogoutUrlShape(url: URL): string | null {
    if (url.protocol !== "https:") {
        return "backchannelLogoutUri must use https";
    }

    if (url.username || url.password) {
        return "backchannelLogoutUri must not include credentials";
    }

    const hostname = normalizeHostname(url.hostname);
    const ipFamily = isIP(hostname);

    if (hostname === "localhost" || hostname.endsWith(".localhost")) {
        return "backchannelLogoutUri must not target localhost";
    }

    if (hostname.endsWith(".local")) {
        return "backchannelLogoutUri must not target local-only hostnames";
    }

    if (ipFamily && blockList.check(hostname, ipFamily === 4 ? "ipv4" : "ipv6")) {
        return "backchannelLogoutUri must not target a private or reserved IP address";
    }

    return null;
}

export function validateBackchannelLogoutUri(uri: string): string | null {
    let url: URL;

    try {
        url = new URL(uri);
    } catch {
        return "backchannelLogoutUri must be a valid URL";
    }

    return validateBackchannelLogoutUrlShape(url);
}

export async function assertBackchannelLogoutDestinationAllowed(
    uri: string
): Promise<URL> {
    const validationError = validateBackchannelLogoutUri(uri);
    if (validationError) {
        throw new Error(validationError);
    }

    const url = new URL(uri);
    const hostname = normalizeHostname(url.hostname);

    // Hostname is an IP address – no need to resolve
    if (isIP(hostname) !== 0) {
        return url;
    }

    const resolvedAddresses = await lookup(hostname, {
        all: true,
        verbatim: true
    });

    if (resolvedAddresses.length === 0) {
        throw new Error(
            "backchannelLogoutUri did not resolve to any destination address"
        );
    }

    const blockedAddress = resolvedAddresses.find((record) =>
        blockList.check(record.address, record.family === 4 ? "ipv4" : "ipv6")
    );

    if (blockedAddress) {
        throw new Error(
            "backchannelLogoutUri resolves to a private or reserved IP address"
        );
    }

    return url;
}
