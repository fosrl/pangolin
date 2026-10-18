import { X509Certificate } from "node:crypto";
import { parseCaCertificates } from "./mtlsCertificate";

export const MAX_UPSTREAM_CA_PEM_LENGTH = 100_000;
export const MAX_UPSTREAM_CA_CERTIFICATES = 20;

/**
 * Accept comments and metadata around certificates, but reject malformed PEM
 * certificate blocks. Persist only normalized X.509 certificates, never the
 * surrounding text supplied by certificate-generation tools.
 */
export function normalizeUpstreamCaPem(input: string): string {
    if (input.length > MAX_UPSTREAM_CA_PEM_LENGTH) {
        throw new Error("CA bundle exceeds the maximum allowed size");
    }

    const certificates = parseCaCertificates(input);
    const beginCount = (input.match(/-----BEGIN CERTIFICATE-----/g) ?? [])
        .length;
    const endCount = (input.match(/-----END CERTIFICATE-----/g) ?? []).length;

    // The shared parser deliberately ignores non-certificate metadata. Do not
    // let it silently ignore extra, incomplete certificate blocks, however.
    if (
        beginCount !== certificates.length ||
        endCount !== certificates.length
    ) {
        throw new Error(
            "Invalid certificate: incomplete PEM certificate block"
        );
    }

    if (certificates.length > MAX_UPSTREAM_CA_CERTIFICATES) {
        throw new Error(
            `A resource can have at most ${MAX_UPSTREAM_CA_CERTIFICATES} CA certificates`
        );
    }

    const now = Date.now();
    for (const cert of certificates) {
        // parseCaCertificates validates X.509 syntax but does not enforce
        // Basic Constraints. An upstream trust anchor must be a CA.
        if (!new X509Certificate(cert.certificate).ca) {
            throw new Error(
                "Invalid CA certificate: Basic Constraints must include CA:TRUE"
            );
        }
        if (now < cert.notBefore) {
            throw new Error("CA certificate is not yet valid");
        }
        if (now >= cert.notAfter) {
            throw new Error("CA certificate has expired");
        }
    }

    return certificates.map((cert) => cert.certificate).join("");
}
