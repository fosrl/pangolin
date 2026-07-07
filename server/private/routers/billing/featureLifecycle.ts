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

import { SubscriptionType } from "./hooks/getSubType";
import { TierFeature, tierMatrix } from "@server/lib/billing/tierMatrix";
import { Tier } from "@server/types/Tiers";
import logger from "@server/logger";
import {
    db,
    idp,
    idpOrg,
    loginPage,
    loginPageBranding,
    loginPageBrandingOrg,
    loginPageOrg,
    orgs,
    resources,
    roles,
    siteResources,
    userOrgRoles,
    siteProvisioningKeyOrg,
    siteProvisioningKeys,
    alertRules,
    targetHealthCheck
} from "@server/db";
import { and, eq, isNull } from "drizzle-orm";

/**
 * Get the maximum allowed retention days for a given tier
 * Returns null for enterprise tier (unlimited)
 */
function getMaxRetentionDaysForTier(tier: Tier | null): number | null {
    if (!tier) {
        return 3; // Free tier
    }

    switch (tier) {
        case "tier1":
            return 7;
        case "tier2":
            return 30;
        case "tier3":
            return 90;
        case "enterprise":
            return null; // No limit
        default:
            return 3; // Default to free tier limit
    }
}

/**
 * Cap retention days to the maximum allowed for the given tier
 */
async function capRetentionDays(
    orgId: string,
    tier: Tier | null
): Promise<void> {
    const maxRetentionDays = getMaxRetentionDaysForTier(tier);

    // If there's no limit (enterprise tier), no capping needed
    if (maxRetentionDays === null) {
        logger.debug(
            `No retention day limit for org ${orgId} on tier ${tier || "free"}`
        );
        return;
    }

    // Get current org settings
    const [org] = await db.select().from(orgs).where(eq(orgs.orgId, orgId));

    if (!org) {
        logger.warn(`Org ${orgId} not found when capping retention days`);
        return;
    }

    const updates: Partial<typeof orgs.$inferInsert> = {};
    let needsUpdate = false;

    // Cap request log retention if it exceeds the limit
    if (
        org.settingsLogRetentionDaysRequest !== null &&
        org.settingsLogRetentionDaysRequest > maxRetentionDays
    ) {
        updates.settingsLogRetentionDaysRequest = maxRetentionDays;
        needsUpdate = true;
        logger.info(
            `Capping request log retention from ${org.settingsLogRetentionDaysRequest} to ${maxRetentionDays} days for org ${orgId}`
        );
    }

    // Cap access log retention if it exceeds the limit
    if (
        org.settingsLogRetentionDaysAccess !== null &&
        org.settingsLogRetentionDaysAccess > maxRetentionDays
    ) {
        updates.settingsLogRetentionDaysAccess = maxRetentionDays;
        needsUpdate = true;
        logger.info(
            `Capping access log retention from ${org.settingsLogRetentionDaysAccess} to ${maxRetentionDays} days for org ${orgId}`
        );
    }

    // Cap action log retention if it exceeds the limit
    if (
        org.settingsLogRetentionDaysAction !== null &&
        org.settingsLogRetentionDaysAction > maxRetentionDays
    ) {
        updates.settingsLogRetentionDaysAction = maxRetentionDays;
        needsUpdate = true;
        logger.info(
            `Capping action log retention from ${org.settingsLogRetentionDaysAction} to ${maxRetentionDays} days for org ${orgId}`
        );
    }

    // Cap action log retention if it exceeds the limit
    if (
        org.settingsLogRetentionDaysConnection !== null &&
        org.settingsLogRetentionDaysConnection > maxRetentionDays
    ) {
        updates.settingsLogRetentionDaysConnection = maxRetentionDays;
        needsUpdate = true;
        logger.info(
            `Capping connection log retention from ${org.settingsLogRetentionDaysConnection} to ${maxRetentionDays} days for org ${orgId}`
        );
    }

    // Apply updates if needed
    if (needsUpdate) {
        await db.update(orgs).set(updates).where(eq(orgs.orgId, orgId));

        logger.info(
            `Successfully capped retention days for org ${orgId} to max ${maxRetentionDays} days`
        );
    } else {
        logger.debug(`No retention day capping needed for org ${orgId}`);
    }
}

export async function handleTierChange(
    orgId: string,
    newTier: SubscriptionType | null,
    previousTier?: SubscriptionType | null
): Promise<void> {
    logger.info(
        `Handling tier change for org ${orgId}: ${previousTier || "none"} -> ${newTier || "free"}`
    );

    // Get all orgs that have this orgId as their billingOrgId
    const associatedOrgs = await db
        .select()
        .from(orgs)
        .where(eq(orgs.billingOrgId, orgId));

    logger.info(
        `Found ${associatedOrgs.length} org(s) associated with billing org ${orgId}`
    );

    // Loop over all associated orgs and apply tier changes
    for (const org of associatedOrgs) {
        await handleTierChangeForOrg(org.orgId, newTier, previousTier);
    }

    logger.info(
        `Completed tier change handling for all orgs associated with billing org ${orgId}`
    );
}

async function handleTierChangeForOrg(
    orgId: string,
    newTier: SubscriptionType | null,
    previousTier?: SubscriptionType | null
): Promise<void> {
    logger.info(
        `Handling tier change for org ${orgId}: ${previousTier || "none"} -> ${newTier || "free"}`
    );

    // License subscriptions are handled separately and don't use the tier matrix
    if (newTier === "license") {
        logger.debug(
            `New tier is license for org ${orgId}, no feature lifecycle handling needed`
        );
        return;
    }

    // If newTier is null, treat as free tier - disable all features
    if (newTier === null) {
        logger.info(
            `Org ${orgId} is reverting to free tier, disabling all paid features`
        );
        // Cap retention days to free tier limits
        await capRetentionDays(orgId, null);

        // Disable all features in the tier matrix
        for (const [featureKey] of Object.entries(tierMatrix)) {
            const feature = featureKey as TierFeature;
            logger.info(
                `Feature ${feature} is not available in free tier for org ${orgId}. Disabling...`
            );
            await disableFeature(orgId, feature);
        }
        logger.info(
            `Completed free tier feature lifecycle handling for org ${orgId}`
        );
        return;
    }

    // Get the tier (cast as Tier since we've ruled out "license" and null)
    const tier = newTier as Tier;

    // Cap retention days to the new tier's limits
    await capRetentionDays(orgId, tier);

    // Check each feature in the tier matrix
    for (const [featureKey, allowedTiers] of Object.entries(tierMatrix)) {
        const feature = featureKey as TierFeature;
        const isFeatureAvailable = allowedTiers.includes(tier);

        if (!isFeatureAvailable) {
            logger.info(
                `Feature ${feature} is not available in tier ${tier} for org ${orgId}. Disabling...`
            );
            await disableFeature(orgId, feature);
        } else {
            logger.debug(
                `Feature ${feature} is available in tier ${tier} for org ${orgId}`
            );
        }
    }

    logger.info(
        `Completed tier change feature lifecycle handling for org ${orgId}`
    );
}

async function disableFeature(
    orgId: string,
    feature: TierFeature
): Promise<void> {
    try {
        switch (feature) {
            case TierFeature.OrgOidc:
                await disableOrgOidc(orgId);
                break;

            case TierFeature.LoginPageDomain:
                await disableLoginPageDomain(orgId);
                break;

            case TierFeature.DeviceApprovals:
                await disableDeviceApprovals(orgId);
                break;

            case TierFeature.LoginPageBranding:
                await disableLoginPageBranding(orgId);
                break;

            case TierFeature.LogExport:
                await disableLogExport(orgId);
                break;

            case TierFeature.AccessLogs:
                await disableAccessLogs(orgId);
                break;

            case TierFeature.ActionLogs:
                await disableActionLogs(orgId);
                break;

            case TierFeature.ConnectionLogs:
                await disableConnectionLogs(orgId);
                break;

            case TierFeature.RotateCredentials:
                await disableRotateCredentials(orgId);
                break;

            case TierFeature.MaintencePage:
                await disableMaintencePage(orgId);
                break;

            case TierFeature.DevicePosture:
                await disableDevicePosture(orgId);
                break;

            case TierFeature.TwoFactorEnforcement:
                await disableTwoFactorEnforcement(orgId);
                break;

            case TierFeature.SessionDurationPolicies:
                await disableSessionDurationPolicies(orgId);
                break;

            case TierFeature.PasswordExpirationPolicies:
                await disablePasswordExpirationPolicies(orgId);
                break;

            case TierFeature.AutoProvisioning:
                await disableAutoProvisioning(orgId);
                break;

            case TierFeature.AdvancedPrivateResources:
                await disableAdvancedPrivateResources(orgId);
                break;

            case TierFeature.FullRbac:
                await disableFullRbac(orgId);
                break;

            case TierFeature.SiteProvisioningKeys:
                await disableSiteProvisioningKeys(orgId);
                break;

            case TierFeature.AlertingRules:
                await disableAlertingRules(orgId);
                break;

            case TierFeature.StandaloneHealthChecks:
                await disableStandaloneHealthChecks(orgId);
                break;

            default:
                logger.warn(
                    `Unknown feature ${feature} for org ${orgId}, skipping`
                );
        }

        logger.info(
            `Successfully disabled feature ${feature} for org ${orgId}`
        );
    } catch (error) {
        logger.error(
            `Error disabling feature ${feature} for org ${orgId}:`,
            error
        );
        throw error;
    }
}

async function disableOrgOidc(orgId: string): Promise<void> {}

async function disableDeviceApprovals(orgId: string): Promise<void> {
    await db
        .update(roles)
        .set({ requireDeviceApproval: false })
        .where(eq(roles.orgId, orgId));

    logger.info(`Disabled device approvals on all roles for org ${orgId}`);
}

async function disableAdvancedPrivateResources(orgId: string): Promise<void> {
    // TODO: implement logic to disable advanced private resourcs like ssh and ssh pam
    // logger.info(
    //     `Disabled advanced private resources on all roles and site resources for org ${orgId}`
    // );
}

async function disableFullRbac(orgId: string): Promise<void> {
    logger.info(`Disabled full RBAC for org ${orgId}`);
}

async function disableSiteProvisioningKeys(orgId: string): Promise<void> {
    const rows = await db
        .select({
            siteProvisioningKeyId: siteProvisioningKeyOrg.siteProvisioningKeyId
        })
        .from(siteProvisioningKeyOrg)
        .where(eq(siteProvisioningKeyOrg.orgId, orgId));

    for (const { siteProvisioningKeyId } of rows) {
        await db.transaction(async (trx) => {
            await trx
                .delete(siteProvisioningKeyOrg)
                .where(
                    and(
                        eq(
                            siteProvisioningKeyOrg.siteProvisioningKeyId,
                            siteProvisioningKeyId
                        ),
                        eq(siteProvisioningKeyOrg.orgId, orgId)
                    )
                );

            const remaining = await trx
                .select()
                .from(siteProvisioningKeyOrg)
                .where(
                    eq(
                        siteProvisioningKeyOrg.siteProvisioningKeyId,
                        siteProvisioningKeyId
                    )
                );

            if (remaining.length === 0) {
                await trx
                    .delete(siteProvisioningKeys)
                    .where(
                        eq(
                            siteProvisioningKeys.siteProvisioningKeyId,
                            siteProvisioningKeyId
                        )
                    );
            }
        });
    }

    logger.info(
        `Removed site provisioning keys for org ${orgId} after tier downgrade`
    );
}

async function disableLoginPageBranding(orgId: string): Promise<void> {
    const [existingBranding] = await db
        .select()
        .from(loginPageBrandingOrg)
        .where(eq(loginPageBrandingOrg.orgId, orgId));

    if (existingBranding) {
        await db
            .delete(loginPageBranding)
            .where(
                eq(
                    loginPageBranding.loginPageBrandingId,
                    existingBranding.loginPageBrandingId
                )
            );

        logger.info(`Disabled login page branding for org ${orgId}`);
    }
}

async function disableLoginPageDomain(orgId: string): Promise<void> {
    const [existingLoginPage] = await db
        .select()
        .from(loginPageOrg)
        .where(eq(loginPageOrg.orgId, orgId))
        .innerJoin(
            loginPage,
            eq(loginPage.loginPageId, loginPageOrg.loginPageId)
        );

    if (existingLoginPage) {
        await db.delete(loginPageOrg).where(eq(loginPageOrg.orgId, orgId));

        await db
            .delete(loginPage)
            .where(
                eq(
                    loginPage.loginPageId,
                    existingLoginPage.loginPageOrg.loginPageId
                )
            );

        logger.info(`Disabled login page domain for org ${orgId}`);
    }
}

async function disableLogExport(orgId: string): Promise<void> {}

async function disableAccessLogs(orgId: string): Promise<void> {
    await db
        .update(orgs)
        .set({ settingsLogRetentionDaysAccess: 0 })
        .where(eq(orgs.orgId, orgId));

    logger.info(`Disabled access logs for org ${orgId}`);
}

async function disableActionLogs(orgId: string): Promise<void> {
    await db
        .update(orgs)
        .set({ settingsLogRetentionDaysAction: 0 })
        .where(eq(orgs.orgId, orgId));

    logger.info(`Disabled action logs for org ${orgId}`);
}

async function disableConnectionLogs(orgId: string): Promise<void> {
    await db
        .update(orgs)
        .set({ settingsLogRetentionDaysConnection: 0 })
        .where(eq(orgs.orgId, orgId));

    logger.info(`Disabled connection logs for org ${orgId}`);
}

async function disableRotateCredentials(orgId: string): Promise<void> {}

async function disableMaintencePage(orgId: string): Promise<void> {
    await db
        .update(resources)
        .set({
            maintenanceModeEnabled: false
        })
        .where(eq(resources.orgId, orgId));

    logger.info(`Disabled maintenance page on all resources for org ${orgId}`);
}

async function disableDevicePosture(orgId: string): Promise<void> {}

async function disableTwoFactorEnforcement(orgId: string): Promise<void> {
    await db
        .update(orgs)
        .set({ requireTwoFactor: false })
        .where(eq(orgs.orgId, orgId));

    logger.info(`Disabled two-factor enforcement for org ${orgId}`);
}

async function disableSessionDurationPolicies(orgId: string): Promise<void> {
    await db
        .update(orgs)
        .set({ maxSessionLengthHours: null })
        .where(eq(orgs.orgId, orgId));

    logger.info(`Disabled session duration policies for org ${orgId}`);
}

async function disablePasswordExpirationPolicies(orgId: string): Promise<void> {
    await db
        .update(orgs)
        .set({ passwordExpiryDays: null })
        .where(eq(orgs.orgId, orgId));

    logger.info(`Disabled password expiration policies for org ${orgId}`);
}

async function disableAlertingRules(orgId: string): Promise<void> {
    await db
        .update(alertRules)
        .set({ enabled: false })
        .where(eq(alertRules.orgId, orgId));

    logger.info(`Disabled all alert rules for org ${orgId}`);
}

async function disableStandaloneHealthChecks(orgId: string): Promise<void> {
    await db
        .update(targetHealthCheck)
        .set({ hcEnabled: false })
        .where(
            and(
                eq(targetHealthCheck.orgId, orgId),
                isNull(targetHealthCheck.targetId)
            )
        );

    logger.info(`Disabled standalone health checks for org ${orgId}`);
}

async function disableAutoProvisioning(orgId: string): Promise<void> {
    // Get all IDP IDs for this org through the idpOrg join table
    const orgIdps = await db
        .select({ idpId: idpOrg.idpId })
        .from(idpOrg)
        .where(eq(idpOrg.orgId, orgId));

    // Update autoProvision to false for all IDPs in this org
    for (const { idpId } of orgIdps) {
        await db
            .update(idp)
            .set({ autoProvision: false })
            .where(eq(idp.idpId, idpId));
    }
}
