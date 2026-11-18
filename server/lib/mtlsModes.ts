// Resource modes that Traefik serves over HTTP(S) - directly, through the
// browser gateway (SSH/RDP/VNC) or through the AI gateway (inference) - so a
// client certificate can be required during the TLS handshake. Raw TCP/UDP
// resources are excluded.
export const MTLS_RESOURCE_MODES = [
    "http",
    "ssh",
    "rdp",
    "vnc",
    "inference"
] as const;

export function resourceModeSupportsMtls(
    mode: string | null | undefined
): boolean {
    return (MTLS_RESOURCE_MODES as readonly string[]).includes(mode ?? "");
}
