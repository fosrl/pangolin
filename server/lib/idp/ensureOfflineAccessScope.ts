export function stripOfflineAccessScope(scopes: string): string {
    return scopes
        .split(/\s+/)
        .map((scope) => scope.trim())
        .filter((scope) => scope.length > 0 && scope !== "offline_access")
        .join(" ");
}

export function ensureOfflineAccessScope(scopes: string): string {
    const parts = scopes
        .split(/\s+/)
        .map((scope) => scope.trim())
        .filter((scope) => scope.length > 0);
    if (!parts.includes("offline_access")) {
        parts.push("offline_access");
    }
    return parts.join(" ");
}

/** Google uses access_type=offline (+ prompt=consent) instead of the offline_access scope. */
export function scopesForSessionRevalidation(
    scopes: string,
    variant?: string | null
): string {
    if (variant === "google") {
        return stripOfflineAccessScope(scopes);
    }
    return ensureOfflineAccessScope(scopes);
}
