export function buildUpstreamTlsTransport(
    tlsServerName: string,
    verifyUpstreamTls: boolean
) {
    return {
        serverName: tlsServerName,
        insecureSkipVerify: !verifyUpstreamTls
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
    verifyUpstreamTls: boolean
) {
    if (!tlsServerName?.trim()) {
        return;
    }

    config.http.serversTransports ??= {};

    config.http.serversTransports[transportName] = buildUpstreamTlsTransport(
        tlsServerName,
        verifyUpstreamTls
    );

    config.http.services[serviceName].loadBalancer.serversTransport =
        transportName;
}
