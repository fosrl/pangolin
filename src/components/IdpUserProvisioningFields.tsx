"use client";

import DirectorySyncConfigWidget from "@app/components/DirectorySyncConfigWidget";
import IdpMappingTabs from "@app/components/IdpMappingTabs";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { RoleMappingRoleOption } from "@app/components/RoleMappingConfigFields";
import { SwitchInput } from "@app/components/SwitchInput";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { RoleMappingConfig } from "@app/lib/idpRoleMapping";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { useTranslations } from "next-intl";
import type { Dispatch, SetStateAction } from "react";
import { useFormContext } from "react-hook-form";

export type IdpUserProvisioningFormValues = {
    allowManualProvisioning: boolean;
    autoProvision: boolean;
    apiIntegrationEnabled: boolean;
    directorySyncEnabled: boolean;
    directorySyncDeletions: boolean;
    mappingsLinked: boolean;
    orgMapping?: string;
    syncOrgMapping?: string;
};

type IdpUserProvisioningFieldsProps = {
    /** Directory sync is only offered for providers with an API integration (google/azure). */
    syncAvailable: boolean;
    orgId: string;
    roles: RoleMappingRoleOption[];
    jitRoleMapping: RoleMappingConfig;
    onJitRoleMappingChange: Dispatch<SetStateAction<RoleMappingConfig>>;
    syncRoleMapping: RoleMappingConfig;
    onSyncRoleMappingChange: Dispatch<SetStateAction<RoleMappingConfig>>;
};

/**
 * Manual, JIT and sync toggles, then the mappings. While `mappingsLinked` is on,
 * one editor (the JIT state) is used for both methods.
 */
// Must be rendered inside the `<Form>` of a form with `IdpUserProvisioningFormValues` fields.
export default function IdpUserProvisioningFields({
    syncAvailable,
    orgId,
    roles,
    jitRoleMapping,
    onJitRoleMappingChange,
    syncRoleMapping,
    onSyncRoleMappingChange
}: IdpUserProvisioningFieldsProps) {
    const t = useTranslations();
    const { isPaidUser } = usePaidStatus();
    const form = useFormContext<IdpUserProvisioningFormValues>();

    const autoProvision = form.watch("autoProvision");
    const apiIntegrationEnabled = form.watch("apiIntegrationEnabled");
    const directorySyncEnabled =
        syncAvailable && form.watch("directorySyncEnabled");
    const mappingsLinked = !syncAvailable || form.watch("mappingsLinked");

    const showJitMappings = autoProvision;
    const showSyncMappings = directorySyncEnabled;

    return (
        <div className="space-y-6">
            <SwitchInput
                id="manual-provisioning-toggle"
                label={t("idpProvisioningManual")}
                description={t("idpProvisioningManualDescription")}
                checked={form.watch("allowManualProvisioning")}
                onCheckedChange={(checked) =>
                    form.setValue("allowManualProvisioning", checked)
                }
            />

            <div className="space-y-4">
                <PaidFeaturesAlert tiers={tierMatrix.autoProvisioning} />
                <SwitchInput
                    id="auto-provision-toggle"
                    label={t("idpProvisioningJit")}
                    description={t("idpProvisioningJitDescription")}
                    checked={autoProvision}
                    onCheckedChange={(checked) =>
                        form.setValue("autoProvision", checked)
                    }
                    disabled={!isPaidUser(tierMatrix.autoProvisioning)}
                />
            </div>

            {syncAvailable && (
                <DirectorySyncConfigWidget
                    directorySyncEnabled={directorySyncEnabled}
                    onDirectorySyncEnabledChange={(checked) =>
                        form.setValue("directorySyncEnabled", checked)
                    }
                    directorySyncDescription={
                        apiIntegrationEnabled
                            ? t("idpDirectorySyncDescription")
                            : t("idpDirectorySyncRequiresApiIntegration")
                    }
                    disabled={!apiIntegrationEnabled}
                    syncDeletions={form.watch("directorySyncDeletions")}
                    onSyncDeletionsChange={(checked) =>
                        form.setValue("directorySyncDeletions", checked)
                    }
                />
            )}

            {(showJitMappings || showSyncMappings) && (
                <div className="space-y-4 border-t pt-6">
                    <div>
                        <h3 className="text-sm font-medium">
                            {t("idpMappings")}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                            {t("idpMappingsDescription")}
                        </p>
                    </div>

                    {syncAvailable && (
                        <SwitchInput
                            id="mappings-separate-toggle"
                            label={t("idpMappingsSeparate")}
                            description={t("idpMappingsSeparateDescription")}
                            checked={!mappingsLinked}
                            onCheckedChange={(separate) => {
                                if (separate) {
                                    // start the sync mappings from the shared ones
                                    onSyncRoleMappingChange(jitRoleMapping);
                                    form.setValue(
                                        "syncOrgMapping",
                                        form.getValues("orgMapping") ?? ""
                                    );
                                }
                                form.setValue("mappingsLinked", !separate);
                            }}
                        />
                    )}

                    {mappingsLinked ? (
                        <IdpMappingTabs
                            fieldIdPrefix="org-idp-mappings"
                            orgId={orgId}
                            roles={roles}
                            roleMapping={jitRoleMapping}
                            onRoleMappingChange={onJitRoleMappingChange}
                            orgMappingField={{
                                control: form.control,
                                name: "orgMapping"
                            }}
                        />
                    ) : (
                        <>
                            {showJitMappings && (
                                <div className="space-y-2">
                                    <h4 className="text-sm font-medium">
                                        {t("idpMappingsJit")}
                                    </h4>
                                    <IdpMappingTabs
                                        fieldIdPrefix="org-idp-jit-mappings"
                                        orgId={orgId}
                                        roles={roles}
                                        roleMapping={jitRoleMapping}
                                        onRoleMappingChange={
                                            onJitRoleMappingChange
                                        }
                                        orgMappingField={{
                                            control: form.control,
                                            name: "orgMapping"
                                        }}
                                    />
                                </div>
                            )}
                            {showSyncMappings && (
                                <div className="space-y-2">
                                    <h4 className="text-sm font-medium">
                                        {t("idpMappingsSync")}
                                    </h4>
                                    <IdpMappingTabs
                                        fieldIdPrefix="org-idp-sync-mappings"
                                        orgId={orgId}
                                        roles={roles}
                                        roleMapping={syncRoleMapping}
                                        onRoleMappingChange={
                                            onSyncRoleMappingChange
                                        }
                                        orgMappingField={{
                                            control: form.control,
                                            name: "syncOrgMapping"
                                        }}
                                    />
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
