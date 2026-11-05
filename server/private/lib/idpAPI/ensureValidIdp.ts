import { db, idp, idpOidcConfig, idpOrg, type IdpOidcConfig } from "@server/db";
import { eq, and } from "drizzle-orm";

export async function ensureValidIdp(
    idpId: number,
    variant: IdpOidcConfig["variant"]
) {
    const [idpRes] = await db
        .select()
        .from(idp)
        .where(eq(idp.idpId, idpId))
        .innerJoin(idpOidcConfig, eq(idpOidcConfig.idpId, idp.idpId))
        .innerJoin(idpOrg, and(eq(idpOrg.idpId, idp.idpId)))
        .limit(1);

    if (!idpRes) {
        throw new Error(
            `IDP API: IdP ${idpId} not found, or it has no OIDC config or org mapping`
        );
    }

    if (!idpRes.idp.apiIntegrationEnabled) {
        throw new Error(
            `IDP API: API integration is not enabled on IdP ${idpId}`
        );
    }

    if (idpRes.idpOidcConfig.variant !== variant) {
        throw new Error(
            `IDP API: IdP ${idpId} has variant "${idpRes.idpOidcConfig.variant}", expected "${variant}"`
        );
    }

    if (!idpRes.idp.directorySyncEnabled && !idpRes.idp.autoProvision) {
        throw new Error(
            `IDP API: IdP ${idpId} has neither directory sync nor auto-provisioning enabled; at least one is required`
        );
    }

    if (idpRes.idpOidcConfig.variant === "google" && !idpRes.idp.apiConfig) {
        throw new Error(
            `IDP API: Google IdP ${idpId} has no API config; a service account is required`
        );
    }

    if (!idpRes.idpOrg.syncOrgMapping && !idpRes.idpOrg.mappingsLinked) {
        throw new Error(
            `IDP API: IdP ${idpId} has no sync org mapping for org ${idpRes.idpOrg.orgId}; set one or link the JIT and sync mappings`
        );
    }

    return idpRes;
}

export type IdpDbResponse = Awaited<ReturnType<typeof ensureValidIdp>>;
