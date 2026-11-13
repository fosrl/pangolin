"use client";

import IdpMappingTabs from "@app/components/IdpMappingTabs";
import IdpProvisioningMethodFields, {
    type IdpProvisioningMethodFormValues
} from "@app/components/IdpProvisioningMethodFields";
import { RoleMappingRoleOption } from "@app/components/RoleMappingConfigFields";
import { SwitchInput } from "@app/components/SwitchInput";
import { RoleMappingConfig } from "@app/lib/idpRoleMapping";
import { useTranslations } from "next-intl";
import type { Dispatch, SetStateAction } from "react";
import { useFormContext } from "react-hook-form";

export type IdpUserProvisioningFormValues = IdpProvisioningMethodFormValues & {
    mappingsLinked: boolean;
    orgMapping?: string;
    syncOrgMapping?: string;
    createMissingRoles: boolean;
    syncCreateMissingRoles: boolean;
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
    const form = useFormContext<IdpUserProvisioningFormValues>();

    const autoProvision = form.watch("autoProvision");
    const directorySyncEnabled =
        syncAvailable && form.watch("directorySyncEnabled");
    const mappingsLinked = !syncAvailable || form.watch("mappingsLinked");
    const createMissingRoles = form.watch("createMissingRoles") ?? false;
    const syncCreateMissingRoles =
        form.watch("syncCreateMissingRoles") ?? false;

    const showJitMappings = autoProvision;
    const showSyncMappings = directorySyncEnabled;

    return (
        <div className="space-y-6">
            <IdpProvisioningMethodFields syncAvailable={syncAvailable} />

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
                                    form.setValue(
                                        "syncCreateMissingRoles",
                                        form.getValues("createMissingRoles")
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
                            createMissingRoles={createMissingRoles}
                            onCreateMissingRolesChange={(checked) =>
                                form.setValue("createMissingRoles", checked)
                            }
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
                                        createMissingRoles={createMissingRoles}
                                        onCreateMissingRolesChange={(checked) =>
                                            form.setValue(
                                                "createMissingRoles",
                                                checked
                                            )
                                        }
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
                                        createMissingRoles={
                                            syncCreateMissingRoles
                                        }
                                        onCreateMissingRolesChange={(checked) =>
                                            form.setValue(
                                                "syncCreateMissingRoles",
                                                checked
                                            )
                                        }
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
