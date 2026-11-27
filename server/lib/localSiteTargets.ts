import ipaddr from "ipaddr.js";

// Hostnames of the services that run next to Pangolin in the standard
// install. A local site's targets are dialled by Traefik from inside that
// network, so pointing one at these would publish Pangolin's own internal
// API, AI gateway, Gerbil or Traefik on a tenant's public hostname.
const RESERVED_HOSTNAMES = ["localhost", "gerbil", "traefik", "badger"];

// Address ranges that always mean "this host" or the cloud metadata service.
const BLOCKED_RANGES = new Set([
    "loopback",
    "unspecified",
    "linkLocal",
    "broadcast"
]);

function reservedHostnames(internalHostname?: string): string[] {
    return [...RESERVED_HOSTNAMES, internalHostname ?? "pangolin"]
        .filter(Boolean)
        .map((h) => h.toLowerCase());
}

/**
 * Returns an error message if a target on a `local` site points at Pangolin
 * itself, the host's loopback interface or a link-local address (such as the
 * cloud metadata service), or null if the target is allowed.
 */
export function localSiteTargetError(
    target: string,
    internalHostname?: string
): string | null {
    const value = target
        .trim()
        .toLowerCase()
        .replace(/^\[|\]$/g, "");
    if (!value) {
        return null;
    }

    if (ipaddr.isValid(value)) {
        let addr = ipaddr.parse(value);
        if (
            addr.kind() === "ipv6" &&
            (addr as ipaddr.IPv6).isIPv4MappedAddress()
        ) {
            addr = (addr as ipaddr.IPv6).toIPv4Address();
        }
        if (BLOCKED_RANGES.has(addr.range())) {
            return `Local site targets cannot point at ${addr.range()} addresses`;
        }
        return null;
    }

    const host = value.replace(/\.$/, "");
    for (const reserved of reservedHostnames(internalHostname)) {
        if (host === reserved || host.endsWith(`.${reserved}`)) {
            return `Local site targets cannot point at Pangolin's own services (${reserved})`;
        }
    }
    if (host.endsWith(".localhost")) {
        return "Local site targets cannot point at localhost";
    }

    return null;
}
