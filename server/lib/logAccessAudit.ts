export async function cleanUpOldLogs(orgId: string, retentionDays: number) {
    return;
}

export async function logAccessAudit(data: {
    action: boolean;
    type: string;
    orgId: string;
    resourceId?: number;
    user?: { username: string; userId: string };
    apiKey?: { name: string | null; apiKeyId: string };
    metadata?: any;
    userAgent?: string;
    requestIp?: string;
}) {
    return;
}