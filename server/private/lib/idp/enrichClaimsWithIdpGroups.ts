/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025-2026 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import license from "#private/license/license";
import { getIDPAPIProvider } from "#private/lib/idpAPI/providers";
import { isLicensedOrSubscribed } from "#private/lib/isLicencedOrSubscribed";
import { db, idpOrg, type Idp, type IdpOidcConfig } from "@server/db";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { isOrgIdentityProviderMode } from "@server/lib/idp/idpExistsForOrg";
import logger from "@server/logger";
import { eq } from "drizzle-orm";

/**
 * An org IdP follows its org's plan. A global IdP isn't tied to one org (and may
 * have no `idpOrg` row yet), so it only needs a license, like its settings.
 */
async function isEntitledToIdpAPI(idpId: number): Promise<boolean> {
    if (!isOrgIdentityProviderMode()) {
        return license.isUnlocked();
    }

    const [policy] = await db
        .select({ orgId: idpOrg.orgId })
        .from(idpOrg)
        .where(eq(idpOrg.idpId, idpId))
        .limit(1);
    if (!policy) {
        return false;
    }

    return isLicensedOrSubscribed(policy.orgId, tierMatrix.idpAPIIntegration);
}

/**
 * Adds the user's groups fetched from the IdP API to the ID token claims, as
 * `groups` (provider group IDs) and `groupNames` (display names), the same
 * shape sync builds with `toClaims`.
 *
 * On Google, ID tokens never carry groups. On Azure, this also covers the groups
 * overage case and apps that don't emit the `groups` claim.
 *
 * Never throws: login must not break because of the API, so on failure the
 * claims are returned as is.
 */
export async function enrichClaimsWithIdpGroups(
    { idp, idpOidcConfig }: { idp: Idp; idpOidcConfig: IdpOidcConfig },
    claims: Record<string, unknown>
): Promise<Record<string, unknown>> {
    // groups are only used by the JIT mappings
    if (!idp.apiIntegrationEnabled || !idp.autoProvision) {
        return claims;
    }

    const provider = getIDPAPIProvider({ idp, idpOidcConfig });
    if (!provider) {
        return claims;
    }

    try {
        if (!(await isEntitledToIdpAPI(idp.idpId))) {
            return claims;
        }

        const externalId = provider.externalIdFromClaims(claims);
        if (!externalId) {
            logger.warn(
                `IdP API: no user ID found in the ID token claims of IdP ${idp.idpId}, skipping group enrichment`
            );
            return claims;
        }

        const groups = await provider.fetchUserGroups({ externalId });
        logger.debug(
            `IdP API: fetched ${groups.length} groups for user ${externalId} of IdP ${idp.idpId}`
        );

        return {
            ...claims,
            groups: groups.map((g) => g.id),
            groupNames: groups.map((g) => g.displayName)
        };
    } catch (e) {
        logger.warn(
            `IdP API: failed to fetch the user groups for IdP ${idp.idpId}, continuing with the ID token claims only`,
            { error: e instanceof Error ? e.message : e }
        );
        return claims;
    }
}
