import { AiCapability } from "@app/lib/aiCapabilities";
import { AiProvider } from "@server/db";

/**
 * Gracefully flush all pending logs (call this on shutdown)
 */
export async function shutdownAiSessionLogger() {}

export async function cleanUpOldLogs(orgId: string, retentionDays: number) {}

export function logAiSession(data: {
    sessionId: string;
    capability: AiCapability;
    provider: AiProvider;
    requestedModel: string | undefined;
    requestBody: unknown;
    responseText: string;
    isStream: boolean;
    statusCode: number;
    orgId: string | null;
    resourceId: number | null;
    siteResourceId: number | null;
    requestUserId: string | null;
    virtualApiKeyId: string | null;
}): void {}
