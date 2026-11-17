import logger from "@server/logger";
import { getBlocklistSource } from "./source";
import { getOrgIdsWithDnsBlocking, pushBlocklistForOrg } from "./pushBlocklist";

const CHECK_INTERVAL_MS = 60_000;

/**
 * Watches the blocklist source for changes and pushes new lists to the devices
 * of orgs that use DNS blocking. Today that means a file on disk was replaced;
 * later it will be a new version from the upstream API.
 */
export function startDnsBlocklistWatcher(): NodeJS.Timeout {
    let lastVersion: string | null = null;

    const timer = setInterval(async () => {
        try {
            const version = await getBlocklistSource().getVersion();
            if (lastVersion !== null && version !== lastVersion) {
                logger.info("DNS blocklist source changed, pushing updates");
                for (const orgId of await getOrgIdsWithDnsBlocking()) {
                    await pushBlocklistForOrg(orgId);
                }
            }
            lastVersion = version;
        } catch (error) {
            logger.error("DNS blocklist watcher failed:", error);
        }
    }, CHECK_INTERVAL_MS);
    timer.unref();
    return timer;
}
