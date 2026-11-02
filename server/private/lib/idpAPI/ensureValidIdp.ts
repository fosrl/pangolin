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
            `Directory sync: IdP ${idpId} not found, or it has no OIDC config or org mapping`
        );
    }

    if (idpRes.idpOidcConfig.variant !== variant) {
        throw new Error(
            `Directory sync: IdP ${idpId} has variant "${idpRes.idpOidcConfig.variant}", expected "${variant}"`
        );
    }

    if (!idpRes.idp.directorySyncEnabled) {
        throw new Error(
            `Directory sync: directory sync is not enabled on IdP ${idpId}`
        );
    }

    if (idpRes.idp.autoProvision) {
        throw new Error(
            `Directory sync: IdP ${idpId} has both directory sync and auto-provisioning enabled; only one can be active`
        );
    }

    if (
        idpRes.idpOidcConfig.variant === "google" &&
        !idpRes.idp.directorySyncConfig
    ) {
        throw new Error(`Directory sync: Google IdP ${idpId} has no directory sync config; a service account is required`);
    }

    return idpRes;
}

export type IdpDbResponse = Awaited<ReturnType<typeof ensureValidIdp>>;
