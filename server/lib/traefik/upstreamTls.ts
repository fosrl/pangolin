export function buildUpstreamTlsTransport(
    tlsServerName: string | null,
    verifyUpstreamTls: boolean,
    certificatePem?: string | null
) {
    const serverName = tlsServerName?.trim();

    return {
        ...(serverName ? { serverName } : {}),
        insecureSkipVerify: !verifyUpstreamTls,
        // A stored CA is only active when upstream TLS verification is enabled.
        ...(verifyUpstreamTls && certificatePem?.trim()
            ? { rootCAs: [certificatePem] }
            : {})
    };
}

type UpstreamTlsConfig = {
    http: {
        serversTransports?: Record<
            string,
            ReturnType<typeof buildUpstreamTlsTransport>
        >;
        services: Record<
            string,
            {
                loadBalancer: {
                    serversTransport?: string;
                };
            }
        >;
    };
};

export function attachUpstreamTlsTransport(
    config: UpstreamTlsConfig,
    serviceName: string,
    transportName: string,
    tlsServerName: string | null,
    verifyUpstreamTls: boolean,
    certificatePem?: string | null
) {
    // Preserve the existing default transport for unconfigured resources.
    // Verification no longer requires a custom SNI hostname.
    if (!tlsServerName?.trim() && !verifyUpstreamTls) {
        return;
    }

    config.http.serversTransports ??= {};

    config.http.serversTransports[transportName] = buildUpstreamTlsTransport(
        tlsServerName,
        verifyUpstreamTls,
        certificatePem
    );

    config.http.services[serviceName].loadBalancer.serversTransport =
        transportName;
}
