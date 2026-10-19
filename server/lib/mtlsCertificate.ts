import { X509Certificate } from "crypto";

export const MAX_MTLS_CERTIFICATES_PER_RESOURCE = 20;

export type ParsedCaCertificate = {
    certificate: string;
    subject: string;
    issuer: string;
    serialNumber: string;
    fingerprint: string;
    notBefore: number;
    notAfter: number;
};

const PEM_CERTIFICATE_REGEX =
    /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

// Certificate subjects/issuers come back as newline-separated "CN=foo\nO=bar";
// flatten to a single readable line for storage and display.
function flattenDn(dn: string): string {
    return dn.split("\n").join(", ");
}

/**
 * Parses one or more PEM-encoded CA certificates (a bundle is split into its
 * individual certificates). Throws an Error with a user-presentable message
 * if the input is not a valid certificate or looks like a private key.
 */
export function parseCaCertificates(input: string): ParsedCaCertificate[] {
    if (/PRIVATE KEY/.test(input)) {
        throw new Error(
            "This looks like a private key, not a certificate. Upload the CA's public certificate only."
        );
    }

    const blocks = input.match(PEM_CERTIFICATE_REGEX);
    if (!blocks || blocks.length === 0) {
        throw new Error(
            "Invalid certificate: no PEM-encoded certificate found. Expected a block starting with -----BEGIN CERTIFICATE-----."
        );
    }

    return blocks.map((block) => {
        let cert: X509Certificate;
        try {
            cert = new X509Certificate(block);
        } catch {
            throw new Error("Invalid certificate: could not parse PEM.");
        }

        return {
            certificate: block.trim() + "\n",
            subject: flattenDn(cert.subject),
            issuer: flattenDn(cert.issuer),
            serialNumber: cert.serialNumber,
            fingerprint: cert.fingerprint256,
            notBefore: new Date(cert.validFrom).getTime(),
            notAfter: new Date(cert.validTo).getTime()
        };
    });
}
