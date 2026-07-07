export const ORG_REBUILD_CONCURRENCY_LIMIT = 10;

const orgActiveRebuilds = new Map<string, number>();

export async function incrementOrgRebuildCount(orgId: string): Promise<void> {
    orgActiveRebuilds.set(orgId, (orgActiveRebuilds.get(orgId) ?? 0) + 1);
}

export async function decrementOrgRebuildCount(orgId: string): Promise<void> {
    const current = orgActiveRebuilds.get(orgId) ?? 0;
    if (current <= 1) {
        orgActiveRebuilds.delete(orgId);
    } else {
        orgActiveRebuilds.set(orgId, current - 1);
    }
}

export async function getOrgActiveRebuildCount(orgId: string): Promise<number> {
    return orgActiveRebuilds.get(orgId) ?? 0;
}

export async function checkOrgRebuildRateLimit(orgId: string): Promise<boolean> {
    return (orgActiveRebuilds.get(orgId) ?? 0) >= ORG_REBUILD_CONCURRENCY_LIMIT;
}
