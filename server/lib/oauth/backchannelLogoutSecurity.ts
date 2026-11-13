import { LookupAddress, LookupOptions } from "node:dns";
import { lookup } from "node:dns";
import { BlockList, isIP, LookupFunction } from "node:net";

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

export function validateBackchannelLogoutUri(uri: string): URL {
    const url = URL.parse(uri);

    if (!url) {
        throw new Error("URL must be valid");
    }
    if (url.protocol !== "https:") {
        throw new Error("URL must use https");
    }

    if (url.username || url.password) {
        throw new Error("URL must not include credentials");
    }

    if (url.hostname === "localhost" || url.hostname.endsWith(".localhost")) {
        throw new Error("URL must not target localhost");
    }

    if (url.hostname.endsWith(".local")) {
        throw new Error("URL must not target local-only hostnames");
    }

    const normalizedHost = normalizeHostname(url.hostname);
    const ipFamily = isIP(normalizedHost);
    if (
        ipFamily &&
        blockList.check(normalizedHost, ipFamily === 4 ? "ipv4" : "ipv6")
    ) {
        throw new Error("URL must not target a private or reserved IP address");
    }

    return url;
}

type LookupCallback = (
    err: NodeJS.ErrnoException | null,
    // NodeJS types are false: address is undefined if an error occurred
    address: string | LookupAddress[],
    family?: number
) => void;

export function lookupBackchannelUri(uri: string): LookupFunction {
    const url = validateBackchannelLogoutUri(uri);

    return (
        hostname: string,
        options: LookupOptions,
        callback: LookupCallback
    ): void => {
        if (hostname !== url.hostname) {
            return callback(
                new Error("Hostname does not equal pinned hostname"),
                undefined as any
            );
        }

        const normalizedHost = normalizeHostname(hostname);
        lookup(normalizedHost, options, (error, result, family) => {
            if (error) {
                return callback(error, result, family);
            }

            const addresses = Array.isArray(result)
                ? result
                : [{ address: result, family: family }];
            const blocked = addresses.find((record) =>
                blockList.check(
                    record.address,
                    record.family === 4 ? "ipv4" : "ipv6"
                )
            );

            if (blocked) {
                return callback(
                    new Error(
                        "Hostname resolves to a private or reserved IP address"
                    ),
                    undefined as any
                );
            }

            return callback(error, result, family);
        });
    };
}

function normalizeHostname(hostname: string): string {
    // Remove IPv6 brackets, NodeJS apis fail if present
    return hostname.replace(/^\[|\]$/g, "");
}
