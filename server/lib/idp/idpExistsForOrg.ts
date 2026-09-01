import { db, idp, idpOrg, Transaction } from "@server/db";
import { and, eq } from "drizzle-orm";
import { build } from "@server/build";

export function isOrgIdentityProviderMode(): boolean {
    return build === "saas" || process.env.IDENTITY_PROVIDER_MODE === "org";
}

/**
 * Checks whether an identity provider can be used for the given org.
 * In org IdP mode, the provider must be linked via idpOrg.
 * In global IdP mode, the provider only needs to exist.
 */
export async function idpExistsForOrg(
    idpId: number,
    orgId: string,
    dbOrTrx: typeof db | Transaction = db
): Promise<boolean> {
    if (isOrgIdentityProviderMode()) {
        const [provider] = await dbOrTrx
            .select({ idpId: idp.idpId })
            .from(idp)
            .innerJoin(idpOrg, eq(idpOrg.idpId, idp.idpId))
            .where(and(eq(idp.idpId, idpId), eq(idpOrg.orgId, orgId)))
            .limit(1);

        return !!provider;
    }

    const [provider] = await dbOrTrx
        .select({ idpId: idp.idpId })
        .from(idp)
        .where(eq(idp.idpId, idpId))
        .limit(1);

    return !!provider;
}
