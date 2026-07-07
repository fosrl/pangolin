import type { GetResourceResponse } from "@server/routers/resource/getResource";
import type { GetResourceAuthInfoResponse } from "@server/routers/resource/getResourceAuthInfo";
import type { GetSiteResourceResponse } from "@server/routers/siteResource/getSiteResource";

export type PublicAuthState = "protected" | "not_protected" | "none";

const BROWSER_MODES = ["http", "ssh", "rdp", "vnc"];

export function derivePublicAuthState(
    mode: string | null,
    authInfo: Pick<
        GetResourceAuthInfoResponse,
        "password" | "pincode" | "sso" | "whitelist" | "headerAuth"
    >
): PublicAuthState {
    if (!BROWSER_MODES.includes(mode || "")) {
        return "none";
    }

    if (
        authInfo.password ||
        authInfo.pincode ||
        authInfo.sso ||
        authInfo.whitelist ||
        authInfo.headerAuth
    ) {
        return "protected";
    }

    return "not_protected";
}

export function formatPublicResourceType(
    resource: Pick<GetResourceResponse, "mode" | "ssl">
): string {
    if (resource.mode === "http") {
        return resource.ssl ? "HTTPS" : "HTTP";
    }

    const mode = (resource.mode || "").toLowerCase();
    if (mode === "tcp") {
        return "TCP";
    }
    if (mode === "udp") {
        return "UDP";
    }

    return (resource.mode || "—").toUpperCase();
}

export type PortProtocolState = "all" | "blocked" | "custom";

function getPortProtocolState(
    value: string | null | undefined
): PortProtocolState {
    if (value === "*") {
        return "all";
    }

    if (!value || value.trim() === "") {
        return "blocked";
    }

    return "custom";
}

export type PortRestrictionDisplay = {
    hasNonDefaultPorts: boolean;
    tcp: { state: PortProtocolState; ports: string | null };
    udp: { state: PortProtocolState; ports: string | null };
};

export function formatPortRestrictionDisplay(
    resource: Pick<
        GetSiteResourceResponse,
        "tcpPortRangeString" | "udpPortRangeString"
    >
): PortRestrictionDisplay {
    const tcpState = getPortProtocolState(resource.tcpPortRangeString);
    const udpState = getPortProtocolState(resource.udpPortRangeString);

    return {
        hasNonDefaultPorts: tcpState !== "all" || udpState !== "all",
        tcp: {
            state: tcpState,
            ports: tcpState === "custom" ? resource.tcpPortRangeString : null
        },
        udp: {
            state: udpState,
            ports: udpState === "custom" ? resource.udpPortRangeString : null
        }
    };
}
