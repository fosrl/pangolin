"use client";

import { SettingsContainer } from "@app/components/Settings";

import { useEnvContext } from "@app/hooks/useEnvContext";
import { useOrgContext } from "@app/hooks/useOrgContext";
import { usePaidStatus } from "@app/hooks/usePaidStatus";

import { orgQueries } from "@app/lib/queries";
import { build } from "@server/build";
import { TierFeature, tierMatrix } from "@server/lib/billing/tierMatrix";
import { useQuery } from "@tanstack/react-query";

import { useMemo } from "react";
import { EditPolicyNameSectionForm } from "./EditPolicyNameSectionForm";
import { PolicyAuthStackSection } from "./PolicyAuthStackSection";
import { PolicyAccessRulesSection } from "./PolicyAccessRulesSection";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";

export type EditPolicyFormSection = "general" | "authentication" | "rules";

export type EditPolicyFormProps = {
    hidePolicyNameForm?: boolean;
    readonly?: boolean;
    resourceId?: number;
    section?: EditPolicyFormSection;
};

export function EditPolicyForm({
    hidePolicyNameForm,
    readonly,
    resourceId,
    section
}: EditPolicyFormProps) {
    const { org } = useOrgContext();
    const { env } = useEnvContext();
    const { isPaidUser } = usePaidStatus();

    // In overlay mode (resourceId provided), policy-level sections are locked.
    // Rules and users/roles sections handle their own hybrid logic via resourceId.
    const isOverlay = resourceId !== undefined;

    const isMaxmindAvailable = !!(
        env.server.maxmind_db_path && env.server.maxmind_db_path.length > 0
    );
    const isMaxmindASNAvailable = !!(
        env.server.maxmind_asn_path && env.server.maxmind_asn_path.length > 0
    );

    const { data: orgIdps = [], isLoading: isLoadingOrgIdps } = useQuery(
        orgQueries.identityProviders({
            orgId: org.org.orgId,
            useOrgOnlyIdp: env.app.identityProviderMode === "org"
        })
    );

    const allIdps = useMemo(() => {
        if (build === "saas") {
            if (isPaidUser(tierMatrix.orgOidc)) {
                return orgIdps.map((idp) => ({
                    id: idp.idpId,
                    text: idp.name
                }));
            }
        } else {
            return orgIdps.map((idp) => ({ id: idp.idpId, text: idp.name }));
        }
        return [];
    }, [orgIdps, isPaidUser]);

    if (isLoadingOrgIdps) {
        return <></>;
    }

    const policyTiers = tierMatrix[TierFeature.ResourcePolicies];
    const isInlinePolicy = hidePolicyNameForm && resourceId === undefined;
    const showPaidAlert = !isInlinePolicy;
    const isDisabled = showPaidAlert && !isPaidUser(policyTiers);
    const effectiveReadonly = readonly || isDisabled;

    const authSection = (
        <PolicyAuthStackSection
            mode="edit"
            orgId={org.org.orgId}
            allIdps={allIdps}
            emailEnabled={env.email.emailEnabled}
            readonly={effectiveReadonly}
            resourceId={resourceId}
        />
    );

    const rulesSection = (
        <PolicyAccessRulesSection
            mode="edit"
            isMaxmindAvailable={isMaxmindAvailable}
            isMaxmindAsnAvailable={isMaxmindASNAvailable}
            readonly={effectiveReadonly}
            resourceId={resourceId}
        />
    );

    if (section === "general") {
        return (
            <>
                {showPaidAlert && <PaidFeaturesAlert tiers={policyTiers} />}
                <div
                    className={
                        isDisabled
                            ? "pointer-events-none opacity-50"
                            : undefined
                    }
                >
                    <EditPolicyNameSectionForm readonly={effectiveReadonly} />
                </div>
            </>
        );
    }

    if (section === "authentication") {
        return (
            <>
                {showPaidAlert && <PaidFeaturesAlert tiers={policyTiers} />}
                <div
                    className={
                        isDisabled
                            ? "pointer-events-none opacity-50"
                            : undefined
                    }
                >
                    {authSection}
                </div>
            </>
        );
    }

    if (section === "rules") {
        return (
            <>
                {showPaidAlert && <PaidFeaturesAlert tiers={policyTiers} />}
                <div
                    className={
                        isDisabled
                            ? "pointer-events-none opacity-50"
                            : undefined
                    }
                >
                    {rulesSection}
                </div>
            </>
        );
    }

    return (
        <>
            {showPaidAlert && <PaidFeaturesAlert tiers={policyTiers} />}
            <div
                className={
                    isDisabled ? "pointer-events-none opacity-50" : undefined
                }
            >
                <SettingsContainer>
                    {!hidePolicyNameForm && !isOverlay && (
                        <EditPolicyNameSectionForm
                            readonly={effectiveReadonly}
                        />
                    )}

                    {authSection}

                    {rulesSection}
                </SettingsContainer>
            </div>
        </>
    );
}
