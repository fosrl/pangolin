import {
    formatSiteResourceDestinationDisplay,
    type SiteResourceDestinationInput
} from "./formatSiteResourceAccess";

export {
    formatSiteResourceDestinationDisplay,
    resolveHttpHttpsDisplayPort,
    type SiteResourceDestinationInput
} from "./formatSiteResourceAccess";

export type PublicResourceAccessInput = {
    mode: string;
    fullDomain: string | null;
    ssl: boolean;
    proxyPort: number | null;
    wildcard: boolean;
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

export function formatPublicResourceAccess(
    resource: PublicResourceAccessInput
): LauncherAccessFields {
    const browserModes = ["http", "ssh", "rdp", "vnc"];
    if (!browserModes.includes(resource.mode)) {
        const port = resource.proxyPort?.toString() ?? "";
        return {
            accessDisplay: port,
            accessCopyValue: port,
            accessUrl: null
        };
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

export function isSafeUrlForLink(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}
