import dns from "node:dns";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";

// Never reachable from tenant-controlled URLs: this host, the cloud metadata
// service (link-local), and non-unicast space.
const ALWAYS_BLOCKED = new Set([
    "unspecified",
    "loopback",
    "linkLocal",
    "broadcast",
    "multicast",
    "reserved"
]);

// Internal networks. Self-hosted installs often point AI providers at local
// models, so these are only blocked when the server asks for it (SaaS).
const PRIVATE = new Set(["private", "uniqueLocal", "carrierGradeNat"]);

export type OutboundPolicy = {
    allowPrivate: boolean;
    // Hostnames that always resolve to Pangolin's own services
    reservedHostnames: string[];
};

/**
 * Reason a resolved address must not be dialled, or null if it is allowed.
 */
export function outboundAddressBlockReason(
    address: string,
    policy: OutboundPolicy
): string | null {
    const value = address.replace(/^\[|\]$/g, "");
    if (!ipaddr.isValid(value)) {
        return `not an IP address: ${address}`;
    }
    let addr = ipaddr.parse(value);
    if (addr.kind() === "ipv6" && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
        addr = (addr as ipaddr.IPv6).toIPv4Address();
    }
    const range = addr.range();
    if (ALWAYS_BLOCKED.has(range)) {
        return `${range} address ${addr.toString()} is not allowed`;
    }
    if (!policy.allowPrivate && PRIVATE.has(range)) {
        return `${range} address ${addr.toString()} is not allowed`;
    }
    return null;
}

/**
 * Reason a URL's hostname must not be used, before DNS: reserved service
 * names and IP literals. Null means "resolve it and check the addresses".
 */
export function outboundHostBlockReason(
    hostname: string,
    policy: OutboundPolicy
): string | null {
    const host = hostname
        .toLowerCase()
        .replace(/^\[|\]$/g, "")
        .replace(/\.$/, "");
    if (!host) {
        return "missing hostname";
    }
    if (ipaddr.isValid(host)) {
        return outboundAddressBlockReason(host, policy);
    }
    if (host === "localhost" || host.endsWith(".localhost")) {
        return "localhost is not allowed";
    }
    for (const reserved of policy.reservedHostnames) {
        const r = reserved.toLowerCase();
        if (host === r || host.endsWith(`.${r}`)) {
            return `${reserved} is not allowed`;
        }
    }
    return null;
}

export class OutboundUrlError extends Error {}

/**
 * Throws OutboundUrlError unless the URL is http(s) and every address its
 * host resolves to is allowed. Use at write time for a clear error; use
 * guardedLookup at request time so DNS changes cannot get around it.
 */
export async function assertSafeOutboundUrlWith(
    url: string,
    policy: OutboundPolicy
): Promise<void> {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new OutboundUrlError("Invalid URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new OutboundUrlError("Only http and https URLs are allowed");
    }
    const hostReason = outboundHostBlockReason(parsed.hostname, policy);
    if (hostReason) {
        throw new OutboundUrlError(`URL not allowed: ${hostReason}`);
    }
    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    let addresses: dns.LookupAddress[];
    try {
        addresses = await dns.promises.lookup(host, { all: true });
    } catch {
        throw new OutboundUrlError(`Could not resolve ${parsed.hostname}`);
    }
    for (const { address } of addresses) {
        const reason = outboundAddressBlockReason(address, policy);
        if (reason) {
            throw new OutboundUrlError(`URL not allowed: ${reason}`);
        }
    }
}

/**
 * A dns lookup for http.request/https.request that refuses to connect to a
 * blocked address, checked on the addresses actually used for the socket.
 */
export function guardedLookupWith(policy: OutboundPolicy): LookupFunction {
    return (hostname, options, callback) => {
        const hostReason = outboundHostBlockReason(hostname, policy);
        if (hostReason) {
            callback(
                new OutboundUrlError(`URL not allowed: ${hostReason}`),
                "",
                0
            );
            return;
        }
        dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
            if (err) {
                callback(err, "", 0);
                return;
            }
            const list = addresses as dns.LookupAddress[];
            for (const { address } of list) {
                const reason = outboundAddressBlockReason(address, policy);
                if (reason) {
                    callback(
                        new OutboundUrlError(`URL not allowed: ${reason}`),
                        "",
                        0
                    );
                    return;
                }
            }
            if ((options as dns.LookupOptions).all) {
                (callback as any)(null, list);
            } else {
                callback(null, list[0].address, list[0].family);
            }
        });
    };
}
