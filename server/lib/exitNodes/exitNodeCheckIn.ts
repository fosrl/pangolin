// Tracks, per process lifetime, whether a given exit node has ever checked in
// (called /gerbil/get-config) since this Pangolin instance started. This lets
// callers distinguish "gerbil hasn't come up yet" (expected briefly after a
// restart, since gerbil depends on pangolin's container starting first) from
// "gerbil was reachable and now isn't" (a real problem worth an error log).
const checkedInExitNodeIds = new Set<number>();

export function markExitNodeCheckedIn(exitNodeId: number): void {
    checkedInExitNodeIds.add(exitNodeId);
}

export function hasExitNodeCheckedIn(exitNodeId: number): boolean {
    return checkedInExitNodeIds.has(exitNodeId);
}
