import cache from "@server/lib/cache";

/** Cache key of the IdP API access token, per provider (see `server/private/lib/idpAPI`). */
export function idpApiTokenCacheKey(
    provider: "azure" | "google",
    idpId: number
): string {
    return `${provider}DirectorySyncToken:${idpId}`;
}

/**
 * Drops the cached IdP API tokens, so the next sync gets a new one. Called when
 * the IdP is saved: its credentials may have changed, and an Entra token keeps
 * the permissions it was issued with.
 */
export async function clearIdpApiTokenCache(idpId: number): Promise<void> {
    await cache.del([
        idpApiTokenCacheKey("azure", idpId),
        idpApiTokenCacheKey("google", idpId)
    ]);
}
