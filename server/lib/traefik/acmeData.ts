/**
 * Types and pure logic for Traefik ACME JSON certificate data.
 * This module has zero server dependencies, so it can be tested standalone.
 */

export interface AcmeCertificate {
    domain: {
        main: string;
        sans?: string[];
    };
    certificate: string;
    key: string;
    Store?: string;
}

export interface AcmeResolver {
    Account?: any;
    Certificates?: AcmeCertificate[];
}

export type AcmeJson = Record<string, AcmeResolver>;

/**
 * Remove all certificates matching a domain from parsed ACME data.
 * Mutates the input and returns whether anything was removed.
 */
export function removeDomainFromAcmeData(
    acmeData: AcmeJson,
    domain: string
): boolean {
    let modified = false;

    for (const resolverName of Object.keys(acmeData)) {
        const resolver = acmeData[resolverName];
        if (!resolver.Certificates || !Array.isArray(resolver.Certificates)) {
            continue;
        }

        const originalLength = resolver.Certificates.length;
        resolver.Certificates = resolver.Certificates.filter((cert) => {
            const isMatch =
                cert.domain.main === domain ||
                cert.domain.sans?.includes(domain);
            return !isMatch;
        });

        if (resolver.Certificates.length !== originalLength) {
            modified = true;
        }
    }

    return modified;
}
