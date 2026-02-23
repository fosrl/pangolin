import * as fs from "fs";
import logger from "@server/logger";
import config from "@server/lib/config";
import { AcmeJson, removeDomainFromAcmeData } from "./acmeData";

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

        const modified = removeDomainFromAcmeData(acmeData, domain);

        if (modified) {
            fs.writeFileSync(acmeJsonPath, JSON.stringify(acmeData, null, 2), {
                encoding: "utf8",
                mode: 0o600
            });
            logger.info(
                `Removed ACME certificate for domain "${domain}" from ${acmeJsonPath}`
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
