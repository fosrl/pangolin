import config from "@server/lib/config";

/**
 * Build the Traefik `tls` block for a domain using the cert-resolver /
 * wildcard-cert logic shared by both the OSS and private Traefik config
 * generators (used whenever certs are obtained directly via ACME rather
 * than through pangolin-dns).
 */
export function buildWildcardTls(params: {
    fullDomain: string;
    hasSubdomain: boolean;
    domainCertResolver?: string | null;
    preferWildcardCert?: boolean | null;
}): { certResolver: string | undefined; domains?: { main: string }[] } {
    const { fullDomain, hasSubdomain, domainCertResolver, preferWildcardCert } =
        params;

    const domainParts = fullDomain.split(".");
    let wildCard =
        domainParts.length <= 2
            ? `*.${domainParts.join(".")}`
            : `*.${domainParts.slice(1).join(".")}`;
    if (!hasSubdomain) {
        wildCard = fullDomain;
    }

    const globalDefaultResolver = config.getRawConfig().traefik.cert_resolver;
    const globalDefaultPreferWildcard =
        config.getRawConfig().traefik.prefer_wildcard_cert;

    const resolverName = domainCertResolver
        ? domainCertResolver.trim()
        : globalDefaultResolver;

    const preferWildcard =
        preferWildcardCert !== undefined && preferWildcardCert !== null
            ? preferWildcardCert
            : globalDefaultPreferWildcard;

    return {
        certResolver: resolverName,
        ...(preferWildcard ? { domains: [{ main: wildCard }] } : {})
    };
}
