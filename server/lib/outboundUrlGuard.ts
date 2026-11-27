import type { LookupFunction } from "node:net";
import config from "@server/lib/config";
import { build } from "@server/build";
import {
    assertSafeOutboundUrlWith,
    guardedLookupWith,
    OutboundPolicy,
    OutboundUrlError
} from "@server/lib/outboundAddress";

export { OutboundUrlError };

export function getOutboundPolicy(): OutboundPolicy {
    const raw = config.getRawConfig();
    const blockPrivate =
        raw.flags?.block_private_outbound_urls ?? build === "saas";
    return {
        allowPrivate: !blockPrivate,
        reservedHostnames: [
            raw.server.internal_hostname,
            "gerbil",
            "traefik",
            "badger",
            "host.docker.internal",
            "metadata.google.internal"
        ].filter(Boolean)
    };
}

/**
 * Throws OutboundUrlError unless the URL is http(s) and every address its
 * host resolves to is allowed by the server's outbound policy.
 */
export function assertSafeOutboundUrl(
    url: string,
    policy: OutboundPolicy = getOutboundPolicy()
): Promise<void> {
    return assertSafeOutboundUrlWith(url, policy);
}

/** DNS lookup for http(s).request that refuses blocked addresses. */
export function guardedLookup(
    policy: OutboundPolicy = getOutboundPolicy()
): LookupFunction {
    return guardedLookupWith(policy);
}
