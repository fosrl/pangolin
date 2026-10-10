"use client";

import DirectorySyncRoleMappingFields from "@app/components/DirectorySyncRoleMappingFields";
import { SwitchInput } from "@app/components/SwitchInput";
import { DirectorySyncRoleMappingConfig } from "@app/lib/idpDirectorySyncRoleMapping";
import { useTranslations } from "next-intl";

type DirectorySyncConfigWidgetProps = {
    directorySyncEnabled: boolean;
    onDirectorySyncEnabledChange: (checked: boolean) => void;
    roleMapping: DirectorySyncRoleMappingConfig;
    onRoleMappingChange: (roleMapping: DirectorySyncRoleMappingConfig) => void;
    syncDeletions: boolean;
    onSyncDeletionsChange: (checked: boolean) => void;
    orgId: string;
    showDirectorySyncSwitch?: boolean;
    disabled?: boolean;
    roleMappingFieldIdPrefix?: string;
    directorySyncSwitchId?: string;
    syncDeletionsSwitchId?: string;
};

export default function DirectorySyncConfigWidget({
    directorySyncEnabled,
    onDirectorySyncEnabledChange,
    roleMapping,
    onRoleMappingChange,
    syncDeletions,
    onSyncDeletionsChange,
    orgId,
    showDirectorySyncSwitch = true,
    disabled = false,
    roleMappingFieldIdPrefix = "org-idp-directory-sync",
    directorySyncSwitchId = "directory-sync-toggle",
    syncDeletionsSwitchId = "directory-sync-deletions-toggle"
}: DirectorySyncConfigWidgetProps) {
    const t = useTranslations();

    const showRoleMapping =
        showDirectorySyncSwitch === false || directorySyncEnabled;

    return (
        <div className="space-y-4">
            {showDirectorySyncSwitch && (
                <div className="mb-4">
                    <SwitchInput
                        id={directorySyncSwitchId}
                        label={t("idpDirectorySync")}
                        description={t("idpDirectorySyncDescription")}
                        checked={directorySyncEnabled}
                        onCheckedChange={onDirectorySyncEnabledChange}
                        disabled={disabled}
                    />
                </div>
            )}

            {showRoleMapping && (
                <div className="space-y-4 p-1">
                    <SwitchInput
                        id={syncDeletionsSwitchId}
                        label={t("idpDirectorySyncDeletions")}
                        description={t("idpDirectorySyncDeletionsDescription")}
                        checked={syncDeletions}
                        onCheckedChange={onSyncDeletionsChange}
                        disabled={disabled}
                    />
                    <DirectorySyncRoleMappingFields
                        fieldIdPrefix={roleMappingFieldIdPrefix}
                        orgId={orgId}
                        value={roleMapping}
                        onChange={onRoleMappingChange}
                    />
                </div>
            )}
        </div>
    );
}
