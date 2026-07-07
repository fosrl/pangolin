import { formatEndpoint, parseEndpoint } from "@server/lib/ip";

export type SiteResourceDestinationInput = {
    mode: "host" | "cidr" | "http" | "ssh";
    destination: string | null;
    destinationPort: number | null;
    scheme: "http" | "https" | null;
};

export function resolveHttpHttpsDisplayPort(
    mode: "http",
    destinationPort: number | null
): number {
    if (destinationPort != null) {
        return destinationPort;
    }
    return 80;
}

export function formatSiteResourceDestinationDisplay(
    row: SiteResourceDestinationInput
): string {
    if (!row.destination) {
        return "";
    }
    const { mode, destination, destinationPort, scheme } = row;
    if (mode !== "http") {
        return destination;
    }
    const port = resolveHttpHttpsDisplayPort(mode, destinationPort);
    const downstreamScheme = scheme ?? "http";
    const hostPart =
        destination.includes(":") && !destination.startsWith("[")
            ? `[${destination}]`
            : destination;
    return `${downstreamScheme}://${hostPart}:${port}`;
}

export type PublicResourceAccessInput = {
    mode: string;
    fullDomain: string | null;
    ssl: boolean;
    proxyPort: number | null;
    wildcard: boolean;
    exitNodeEndpoint?: string | null;
};

export type SiteResourceAccessInput = {
    mode: string;
    destination: string | null;
    destinationPort: number | null;
    scheme: "http" | "https" | null;
    ssl: boolean;
    fullDomain: string | null;
    alias: string | null;
    aliasAddress: string | null;
};

export type LauncherAccessFields = {
    accessDisplay: string;
    accessCopyValue: string;
    accessUrl: string | null;
};

function formatTcpUdpResourceAccess(
    exitNodeEndpoint: string | null | undefined,
    proxyPort: number | null
): LauncherAccessFields {
    if (proxyPort == null) {
        return {
            accessDisplay: "",
            accessCopyValue: "",
            accessUrl: null
        };
    }

    if (!exitNodeEndpoint?.trim()) {
        const port = proxyPort.toString();
        return {
            accessDisplay: port,
            accessCopyValue: port,
            accessUrl: null
        };
    }

    const parsed = parseEndpoint(exitNodeEndpoint);
    const host = parsed?.ip ?? exitNodeEndpoint.trim();
    const access = formatEndpoint(host, proxyPort);

    return {
        accessDisplay: access,
        accessCopyValue: access,
        accessUrl: null
    };
}

export function formatPublicResourceAccess(
    resource: PublicResourceAccessInput
): LauncherAccessFields {
    const browserModes = ["http", "ssh", "rdp", "vnc"];
    if (!browserModes.includes(resource.mode)) {
        return formatTcpUdpResourceAccess(
            resource.exitNodeEndpoint,
            resource.proxyPort
        );
    }

    if (!resource.fullDomain) {
        return {
            accessDisplay: "",
            accessCopyValue: "",
            accessUrl: null
        };
    }

    const url = `${resource.ssl ? "https" : "http"}://${resource.fullDomain}`;
    return {
        accessDisplay: url,
        accessCopyValue: url,
        accessUrl: resource.wildcard ? null : url
    };
}

export function formatSiteResourceAccess(
    resource: SiteResourceAccessInput
): LauncherAccessFields {
    if (resource.alias) {
        return {
            accessDisplay: resource.alias,
            accessCopyValue: resource.alias,
            accessUrl: null
        };
    }

    if (resource.mode === "http" && resource.fullDomain) {
        const url = `${resource.ssl ? "https" : "http"}://${resource.fullDomain}`;
        return {
            accessDisplay: url,
            accessCopyValue: url,
            accessUrl: url
        };
    }

    const destination = formatSiteResourceDestinationDisplay({
        mode: resource.mode as SiteResourceDestinationInput["mode"],
        destination: resource.destination,
        destinationPort: resource.destinationPort,
        scheme: resource.scheme
    });

    if (destination) {
        return {
            accessDisplay: destination,
            accessCopyValue: destination,
            accessUrl: resource.mode === "http" ? destination : null
        };
    }

    if (resource.aliasAddress) {
        return {
            accessDisplay: resource.aliasAddress,
            accessCopyValue: resource.aliasAddress,
            accessUrl: null
        };
    }

    return {
        accessDisplay: "",
        accessCopyValue: "",
        accessUrl: null
    };
}
