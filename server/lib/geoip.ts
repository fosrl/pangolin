import logger from "@server/logger";
import { maxmindLookup } from "@server/db/maxmind";

export async function getCountryCodeForIp(
    ip: string
): Promise<string | undefined> {
    try {
        if (!maxmindLookup) {
            logger.debug(
                "MaxMind DB path not configured, cannot perform GeoIP lookup"
            );
            return;
        }

        const result = maxmindLookup.get(ip);

        if (!result || !result.country) {
            return;
        }

        const { country } = result;

        logger.debug(
            `GeoIP lookup successful for IP ${ip}: ${country.iso_code}`
        );

        return country.iso_code;
    } catch (error) {
        logger.error("Error fetching config in verify session:", error);
    }

    return;
}