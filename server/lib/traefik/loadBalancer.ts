import { TargetWithSite } from "./types";

/**
 * Build the loadBalancer.servers list for an HTTP-mode resource, preferring
 * currently-online sites but falling back to all enabled/healthy targets if
 * none are online yet (so there's still some feedback before sites report
 * back over the receive-bandwidth endpoint).
 */
export function buildHttpLoadBalancerServers(targets: TargetWithSite[]) {
    const anySitesOnline = targets.some((target) => target.site.online);

    return targets
        .filter((target) => {
            if (!target.enabled) {
                return false;
            }

            if (target.health == "unhealthy") {
                return false;
            }

            // If any sites are online, exclude offline sites
            if (anySitesOnline && !target.site.online) {
                return false;
            }

            if (
                target.site.type === "local" ||
                target.site.type === "wireguard"
            ) {
                if (!target.ip || !target.port || !target.method) {
                    return false;
                }
            } else if (target.site.type === "newt") {
                if (
                    !target.internalPort ||
                    !target.method ||
                    !target.site.subnet
                ) {
                    return false;
                }
            }
            return true;
        })
        .map((target) => {
            if (
                target.site.type === "local" ||
                target.site.type === "wireguard"
            ) {
                return {
                    url: `${target.method}://${target.ip}:${target.port}`
                };
            } else if (target.site.type === "newt") {
                const ip = target.site.subnet!.split("/")[0];
                return {
                    url: `${target.method}://${ip}:${target.internalPort}`
                };
            }
        })
        .filter(
            (v, i, a) => a.findIndex((t) => t && v && t.url === v.url) === i
        );
}

export function buildStickySessionCookie(ssl: boolean | null) {
    return {
        sticky: {
            cookie: {
                name: "p_sticky", // TODO: make this configurable via config.yml like other cookies
                secure: ssl,
                httpOnly: true
            }
        }
    };
}

/**
 * Build the loadBalancer.servers list for a TCP/UDP-mode resource.
 */
export function buildTcpUdpLoadBalancerServers(targets: TargetWithSite[]) {
    const anySitesOnline = targets.some((target) => target.site.online);

    return targets
        .filter((target) => {
            if (!target.enabled) {
                return false;
            }

            // If any sites are online, exclude offline sites
            if (anySitesOnline && !target.site.online) {
                return false;
            }

            if (
                target.site.type === "local" ||
                target.site.type === "wireguard"
            ) {
                if (!target.ip || !target.port) {
                    return false;
                }
            } else if (target.site.type === "newt") {
                if (!target.internalPort || !target.site.subnet) {
                    return false;
                }
            }
            return true;
        })
        .map((target) => {
            if (
                target.site.type === "local" ||
                target.site.type === "wireguard"
            ) {
                return {
                    address: `${target.ip}:${target.port}`
                };
            } else if (target.site.type === "newt") {
                const ip = target.site.subnet!.split("/")[0];
                return {
                    address: `${ip}:${target.internalPort}`
                };
            }
        });
}

export function buildStickySessionIp() {
    return {
        sticky: {
            ipStrategy: {
                depth: 0,
                sourcePort: true
            }
        }
    };
}
