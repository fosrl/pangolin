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
import type { IdpGroupEnrichment } from "@server/lib/idp/enrichClaimsWithIdpGroups";
import { and, eq } from "drizzle-orm";

/**
 * Why the login doesn't fetch the API groups, `null` when it does. The IdP must
 * be entitled to the API integration, and for a real login auto-provision must
 * be on (groups are only used by the JIT mappings). A test login always fetches
 * them when entitled, to show the claims the mappings would get.
 *
 * - Org IdP mode: auto-provision lives on the `idpOrg` policies (the `idp` row's
 *   flag is always false), and the IdP follows its org's plan.
 * - Global IdPs: the `idp` row's flag, and only a license is needed, like its
 *   settings (a global IdP isn't tied to one org and may have no `idpOrg` row).
 */
async function enrichmentSkipReason(
    idp: Idp,
    test: boolean
): Promise<"autoProvisionOff" | "notEntitled" | null> {
    if (!isOrgIdentityProviderMode()) {
        if (!test && !idp.autoProvision) {
            return "autoProvisionOff";
        }
        return (await license.isUnlocked()) ? null : "notEntitled";
    }

    const policies = await db
        .select({ orgId: idpOrg.orgId })
        .from(idpOrg)
        .where(
            and(
                eq(idpOrg.idpId, idp.idpId),
                test ? undefined : eq(idpOrg.autoProvision, true)
            )
        );
    if (policies.length === 0) {
        return test ? "notEntitled" : "autoProvisionOff";
    }

    for (const policy of policies) {
        if (
            await isLicensedOrSubscribed(
                policy.orgId,
                tierMatrix.idpAPIIntegration
            )
        ) {
            return null;
        }
    }
    return "notEntitled";
}

/**
 * Adds the user's groups fetched from the IdP API to the ID token claims, as
 * `groups` (provider group IDs) and `groupNames` (display names), the same
 * shape sync builds with `toClaims`. Also says what it did (`enrichment`), for
 * the test login result.
 *
 * On Google, ID tokens never carry groups. On Azure, this also covers the groups
 * overage case and apps that don't emit the `groups` claim.
 *
 * Never throws: login must not break because of the API, so on failure the
 * claims are returned as is.
 */
export async function enrichClaimsWithIdpGroups(
    { idp, idpOidcConfig }: { idp: Idp; idpOidcConfig: IdpOidcConfig },
    claims: Record<string, unknown>,
    { test = false }: { test?: boolean } = {}
): Promise<{
    claims: Record<string, unknown>;
    enrichment: IdpGroupEnrichment;
}> {
    const skipped = (
        reason: Extract<IdpGroupEnrichment, { status: "skipped" }>["reason"]
    ) => ({ claims, enrichment: { status: "skipped" as const, reason } });

    const provider = getIDPAPIProvider({ idp, idpOidcConfig });
    if (!provider) {
        return skipped("notAvailable");
    }
    if (!idp.apiIntegrationEnabled) {
        return skipped("apiIntegrationOff");
    }

    try {
        const skipReason = await enrichmentSkipReason(idp, test);
        if (skipReason) {
            return skipped(skipReason);
        }

        const externalId = provider.externalIdFromClaims(claims);
        if (!externalId) {
            logger.warn(
                `IdP API: no user ID found in the ID token claims of IdP ${idp.idpId}, skipping group enrichment`
            );
            return skipped("noUserId");
        }

        const groups = await provider.fetchUserGroups({ externalId });
        logger.debug(
            `IdP API: fetched ${groups.length} groups for user ${externalId} of IdP ${idp.idpId}`
        );

        return {
            claims: {
                ...claims,
                groups: groups.map((g) => g.id),
                groupNames: groups.map((g) => g.displayName)
            },
            enrichment: { status: "added", groupCount: groups.length }
        };
    } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        logger.warn(
            `IdP API: failed to fetch the user groups for IdP ${idp.idpId}, continuing with the ID token claims only`,
            { error }
        );
        return { claims, enrichment: { status: "failed", error } };
    }
}
