import { db, orgs } from "@server/db";
import { cleanUpOldLogs as cleanUpOldAccessLogs } from "#dynamic/lib/logAccessAudit";
import { cleanUpOldLogs as cleanUpOldActionLogs } from "#dynamic/middlewares/logActionAudit";
import { cleanUpOldLogs as cleanUpOldRequestLogs } from "@server/routers/badger/logRequestAudit";
import { gt, or } from "drizzle-orm";

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
                        settingsLogRetentionDaysRequest
                    );
                }

                if (settingsLogRetentionDaysAccess > 0) {
                    await cleanUpOldAccessLogs(
                        orgId,
                        settingsLogRetentionDaysRequest
                    );
                }

                if (settingsLogRetentionDaysRequest > 0) {
                    await cleanUpOldRequestLogs(
                        orgId,
                        settingsLogRetentionDaysRequest
                    );
                }
            }
        },
        // 3 * 60 * 60 * 1000
        60 * 1000 // for testing
    ); // every 3 hours
}
