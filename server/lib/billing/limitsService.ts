import { db, limits } from "@server/db";
import { and, eq } from "drizzle-orm";
import { LimitSet } from "./limitSet";
import { LimitId } from "./features";
import logger from "@server/logger";

class LimitService {
    async applyLimitSetToOrg(orgId: string, limitSet: LimitSet): Promise<void> {
        const limitEntries = Object.entries(limitSet);

        // delete existing limits for the org
        await db.transaction(async (trx) => {
            await trx.delete(limits).where(eq(limits.orgId, orgId));
            for (const [featureId, entry] of limitEntries) {
                const limitId = `${orgId}-${featureId}`;
                const { value, description } = entry;
                // get the limit first
                const [limit] = await trx
                    .select()
                    .from(limits)
                    .where(eq(limits.limitId, limitId))
                    .limit(1);

                // check if its overriden
                if (limit && limit.override) {
                    logger.debug(
                        `Skipping limit ${limitId} for org ${orgId} since it is overridden...`
                    );
                    continue;
                }

                await trx
                    .insert(limits)
                    .values({ limitId, orgId, featureId, value, description });
            }
        });
    }

    async getOrgLimit(
        orgId: string,
        featureId: LimitId
    ): Promise<number | null> {
        const limitId = `${orgId}-${featureId}`;
        const [limit] = await db
            .select()
            .from(limits)
            .where(and(eq(limits.limitId, limitId)))
            .limit(1);

        return limit ? limit.value : null;
    }
}

export const limitsService = new LimitService();
