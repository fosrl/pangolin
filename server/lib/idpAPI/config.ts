import type { DirectorySyncVariant } from "@app/lib/idpDirectorySyncConfig";

/**
 * The IdP API integration is not part of the open-source build: there is never
 * a stored config to read, and nothing is stored.
 */
export function decryptDirectorySyncConfig(
    _encrypted: string | null
): Record<string, unknown> | null {
    return null;
}

type ResolveResult =
    | { success: true; value: string | undefined }
    | { success: false; error: string };

export function resolveIDPAPIConfig(_params: {
    variant: DirectorySyncVariant;
    incomingApiConfig: Record<string, unknown> | undefined;
    existingEncryptedApiConfig: string | null;
    apiIntegrationEnabled: boolean;
}): ResolveResult {
    return { success: true, value: undefined };
}
