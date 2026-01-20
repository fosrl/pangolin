import { db, orgs } from "@server/db";
import { cleanUpOldLogs as cleanUpOldAccessLogs } from "#dynamic/lib/logAccessAudit";
import { cleanUpOldLogs as cleanUpOldActionLogs } from "#dynamic/middlewares/logActionAudit";
import { cleanUpOldLogs as cleanUpOldRequestLogs } from "@server/routers/badger/logRequestAudit";
import { gt, or } from "drizzle-orm";
import { cleanUpOldFingerprintSnapshots } from "@server/routers/olm/fingerprintingUtils";

export function initLogCleanupInterval() {
    return setInterval(
        async () => {
            const orgsToClean = await db
                .select({
                    orgId: orgs.orgId,
                    settingsLogRetentionDaysAction:
                        orgs.settingsLogRetentionDaysAction,
                    settingsLogRetentionDaysAccess:
                        orgs.settingsLogRetentionDaysAccess,
                    settingsLogRetentionDaysRequest:
                        orgs.settingsLogRetentionDaysRequest
                })
                .from(orgs)
                .where(
                    or(
                        gt(orgs.settingsLogRetentionDaysAction, 0),
                        gt(orgs.settingsLogRetentionDaysAccess, 0),
                        gt(orgs.settingsLogRetentionDaysRequest, 0)
                    )
                );

            // TODO: handle when there are multiple nodes doing this clearing using redis
            for (const org of orgsToClean) {
                const {
                    orgId,
                    settingsLogRetentionDaysAction,
                    settingsLogRetentionDaysAccess,
                    settingsLogRetentionDaysRequest
                } = org;

                if (settingsLogRetentionDaysAction > 0) {
                    await cleanUpOldActionLogs(
                        orgId,
                        settingsLogRetentionDaysAction
                    );
                }

                if (settingsLogRetentionDaysAccess > 0) {
                    await cleanUpOldAccessLogs(
                        orgId,
                        settingsLogRetentionDaysAccess
                    );
                }

                if (settingsLogRetentionDaysRequest > 0) {
                    await cleanUpOldRequestLogs(
                        orgId,
                        settingsLogRetentionDaysRequest
                    );
                }
            }

            await cleanUpOldFingerprintSnapshots(365);
        },
        3 * 60 * 60 * 1000
    ); // every 3 hours
}

export function calculateCutoffTimestamp(retentionDays: number): number {
    const now = Math.floor(Date.now() / 1000);
    if (retentionDays === 9001) {
        // Special case: data is erased at the end of the year following the year it was generated
        // This means we delete logs from 2 years ago or older (logs from year Y are deleted after Dec 31 of year Y+1)
        const currentYear = new Date().getFullYear();
        // Cutoff is the start of the year before last (Jan 1, currentYear - 1 at 00:00:00)
        // Any logs before this date are from 2+ years ago and should be deleted
        const cutoffDate = new Date(Date.UTC(currentYear - 1, 0, 1, 0, 0, 0));
        return Math.floor(cutoffDate.getTime() / 1000);
    } else {
        return now - retentionDays * 24 * 60 * 60;
    }
}
