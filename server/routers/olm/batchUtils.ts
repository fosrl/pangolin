// Shared parsing for the olm relay/unrelay/local/unlocal websocket messages, which accept
// either a single siteId or a batched siteIds array (with a parallel chainIds array), so
// olm clients with many sites can coalesce decisions into one message instead of sending
// one message per site. Older olm clients that only ever send the singular form are handled
// identically to a batch of one, and the reply mirrors whichever form the request used.

import { db, newts } from "@server/db";
import { inArray } from "drizzle-orm";

// Resolves the newtId for each of the given siteIds in a single query, for batching the
// resulting newt/wg/peer/update pushes instead of looking each one up individually.
export async function resolveNewtIdsBySite(
    siteIds: number[]
): Promise<Map<number, string>> {
    if (siteIds.length === 0) {
        return new Map();
    }

    const rows = await db
        .select({ siteId: newts.siteId, newtId: newts.newtId })
        .from(newts)
        .where(inArray(newts.siteId, siteIds));

    const map = new Map<number, string>();
    for (const row of rows) {
        if (row.siteId != null) {
            map.set(row.siteId, row.newtId);
        }
    }
    return map;
}

export type SiteChainBatch = {
    siteIds: number[];
    chainIds: (string | undefined)[];
    isBatch: boolean;
};

export function parseSiteChainBatch(data: any): SiteChainBatch {
    if (Array.isArray(data?.siteIds)) {
        const siteIds: number[] = data.siteIds;
        const chainIds: (string | undefined)[] =
            Array.isArray(data.chainIds) &&
            data.chainIds.length === siteIds.length
                ? data.chainIds
                : siteIds.map(() => data.chainId);
        return { siteIds, chainIds, isBatch: true };
    }

    return {
        siteIds: data?.siteId !== undefined ? [data.siteId] : [],
        chainIds: [data?.chainId],
        isBatch: false
    };
}
