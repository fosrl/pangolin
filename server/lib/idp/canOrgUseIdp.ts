import { db, idp, idpOrg } from "@server/db";
import { and, eq } from "drizzle-orm";
import { build } from "@server/build";

/**
 * Checks whether an identity provider can be used for resource auth in the
 * given org. When IdPs are org-scoped (SaaS build or identity_provider_mode
 * set to "org"), the IdP must be linked to the org. Otherwise any server-wide
 * IdP is valid, matching the IdPs offered on the resource login page.
 */
export async function canOrgUseIdp(
    idpId: number,
    orgId: string
): Promise<boolean> {
    const [provider] = await db
        .select()
        .from(idp)
        .leftJoin(
            idpOrg,
            and(eq(idpOrg.idpId, idp.idpId), eq(idpOrg.orgId, orgId))
        )
        .where(eq(idp.idpId, idpId))
        .limit(1);

    if (!provider) {
        return false;
    }

    const orgScopedIdps =
        build === "saas" || process.env.IDENTITY_PROVIDER_MODE === "org";

    return !orgScopedIdps || provider.idpOrg !== null;
}
