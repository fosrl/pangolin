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

import { AzureDirectorySyncProvider } from "#private/lib/idpAPI/azure";
import { ensureValidIdp } from "#private/lib/idpAPI/ensureValidIdp";
import { GoogleDirectorySyncProvider } from "#private/lib/idpAPI/google";
import type { IDPAPIProvider } from "#private/lib/idpAPI/types";
import { isLicensedOrSubscribed } from "#private/lib/isLicencedOrSubscribed";
import type { Idp, IdpOidcConfig } from "@server/db";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import logger from "@server/logger";

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

    const providerMap = {
        azure: AzureDirectorySyncProvider,
        google: GoogleDirectorySyncProvider
    } satisfies Record<string, typeof IDPAPIProvider>;

    const variant = idpOidcConfig.variant;

    const providerType = providerMap[variant as keyof typeof providerMap];

    if (!providerType) {
        return claims;
    }

    try {
        const idpRes = await ensureValidIdp(idp.idpId, variant);

        const isEntitled = await isLicensedOrSubscribed(
            idpRes.idpOrg.orgId,
            tierMatrix.idpAPIIntegration
        );
        if (!isEntitled) {
            return claims;
        }

        const provider = new providerType(idpRes);

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
