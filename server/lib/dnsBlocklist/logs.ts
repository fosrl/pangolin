// The DNS block log is an enterprise feature. This is the OSS version of
// server/private/lib/dnsBlocklist/logs.ts.

export async function cleanUpOldDnsBlockLogs(
    orgId: string,
    retentionDays: number
): Promise<void> {
    return;
}

export async function flushDnsBlockLogToDb(): Promise<void> {
    return;
}
