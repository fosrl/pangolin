import { db, resourceUpstreamCa } from "@server/db";
import { inArray } from "drizzle-orm";

// Query once per config build, not once per target or per route. Chunk the
// resource IDs to avoid SQLite's bound-variable limits on large deployments.
export async function loadUpstreamCa(
    resourceIds: number[]
): Promise<Map<number, string>> {
    const certificates = new Map<number, string>();
    const uniqueIds = [...new Set(resourceIds)];

    for (let offset = 0; offset < uniqueIds.length; offset += 500) {
        const rows = await db
            .select({
                resourceId: resourceUpstreamCa.resourceId,
                certificatePem: resourceUpstreamCa.certificatePem
            })
            .from(resourceUpstreamCa)
            .where(
                inArray(
                    resourceUpstreamCa.resourceId,
                    uniqueIds.slice(offset, offset + 500)
                )
            );

        for (const row of rows) {
            certificates.set(row.resourceId, row.certificatePem);
        }
    }

    return certificates;
}
