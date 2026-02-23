import * as fs from "fs";
import logger from "@server/logger";
import config from "@server/lib/config";

/**
 * Structure of Traefik's acme.json file.
 * Each resolver (e.g., "letsencrypt") has an Account and Certificates array.
 */
interface AcmeCertificate {
    domain: {
        main: string;
        sans?: string[];
    };
    certificate: string;
    key: string;
    Store?: string;
}

interface AcmeResolver {
    Account?: any;
    Certificates?: AcmeCertificate[];
}

type AcmeJson = Record<string, AcmeResolver>;

/**
 * Remove a domain's certificate from Traefik's acme.json file.
 * This prevents Traefik from continuing to renew certificates for
 * domains that are no longer associated with any active resource.
 *
 * @param domain - The full domain to remove (e.g., "app.example.com")
 */
export async function removeDomainFromAcmeJson(domain: string): Promise<void> {
    const acmeJsonPath = config.getRawConfig().traefik.acme_json_path;

    if (!acmeJsonPath) {
        logger.debug(
            "No acme_json_path configured, skipping ACME certificate cleanup"
        );
        return;
    }

    if (!fs.existsSync(acmeJsonPath)) {
        logger.debug(
            `ACME JSON file not found at ${acmeJsonPath}, skipping cleanup`
        );
        return;
    }

    try {
        const rawContent = fs.readFileSync(acmeJsonPath, "utf8");
        const acmeData: AcmeJson = JSON.parse(rawContent);

        let modified = false;

        for (const resolverName of Object.keys(acmeData)) {
            const resolver = acmeData[resolverName];
            if (
                !resolver.Certificates ||
                !Array.isArray(resolver.Certificates)
            ) {
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
                logger.info(
                    `Removed certificate for domain "${domain}" from ACME resolver "${resolverName}"`
                );
            }
        }

        if (modified) {
            fs.writeFileSync(acmeJsonPath, JSON.stringify(acmeData, null, 2), {
                encoding: "utf8",
                mode: 0o600
            });
            logger.info(
                `Updated acme.json after removing certificates for domain "${domain}"`
            );
        }
    } catch (error) {
        // Certificate cleanup is best-effort — don't fail the resource deletion
        logger.error(
            `Failed to clean up ACME certificate for domain "${domain}":`,
            error
        );
    }
}
