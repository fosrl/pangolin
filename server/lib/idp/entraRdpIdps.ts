import { db, idp, idpOidcConfig, idpOrg } from "@server/db";
import { and, eq } from "drizzle-orm";
import { isEntraAuthority } from "@server/lib/idp/entraRdp";

export type EntraIdp = { idpId: number; name: string };

export async function listEntraIdpsForOrg(orgId: string): Promise<EntraIdp[]> {
    const orgIdps = await db
        .select({
            idpId: idp.idpId,
            name: idp.name,
            authUrl: idpOidcConfig.authUrl
        })
        .from(idpOrg)
        .innerJoin(idp, eq(idp.idpId, idpOrg.idpId))
        .innerJoin(idpOidcConfig, eq(idpOidcConfig.idpId, idp.idpId))
        .where(and(eq(idpOrg.orgId, orgId), eq(idp.type, "oidc")));

    return orgIdps
        .filter((orgIdp) => isEntraAuthority(orgIdp.authUrl))
        .map(({ idpId, name }) => ({ idpId, name }));
}
