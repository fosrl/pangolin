export type OidcIdpVariant = "oidc" | "google" | "azure";

/**
 * Claim holding the user's immutable ID at the provider, stored in `users.externalUserId`.
 * Entra's `sub` is pairwise per app, so Azure uses `oid` (equal to the Graph user `id`).
 */
export function defaultExternalIdPath(variant: OidcIdpVariant): string {
    return variant === "azure" ? "oid" : "sub";
}
