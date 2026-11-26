"use client";

import { SwitchInput } from "@app/components/SwitchInput";
import { useTranslations } from "next-intl";

type DirectorySyncConfigWidgetProps = {
    directorySyncEnabled: boolean;
    onDirectorySyncEnabledChange: (checked: boolean) => void;
    syncDeletions: boolean;
    onSyncDeletionsChange: (checked: boolean) => void;
    directorySyncDescription?: string;
    disabled?: boolean;
    directorySyncSwitchId?: string;
    syncDeletionsSwitchId?: string;
};

// The sync mappings are edited along with the JIT ones, see `IdpMappingTabs`.
export default function DirectorySyncConfigWidget({
    directorySyncEnabled,
    onDirectorySyncEnabledChange,
    syncDeletions,
    onSyncDeletionsChange,
    directorySyncDescription,
    disabled = false,
    directorySyncSwitchId = "directory-sync-toggle",
    syncDeletionsSwitchId = "directory-sync-deletions-toggle"
}: DirectorySyncConfigWidgetProps) {
    const t = useTranslations();

    return (
        <div className="space-y-4">
            <SwitchInput
                id={directorySyncSwitchId}
                label={t("idpDirectorySync")}
                description={directorySyncDescription}
                checked={directorySyncEnabled}
                onCheckedChange={onDirectorySyncEnabledChange}
                disabled={disabled}
            />

            {directorySyncEnabled && (
                <div className="ml-6 border-l pl-4">
                    <SwitchInput
                        id={syncDeletionsSwitchId}
                        label={t("idpDirectorySyncDeletions")}
                        description={t("idpDirectorySyncDeletionsDescription")}
                        checked={syncDeletions}
                        onCheckedChange={onSyncDeletionsChange}
                        disabled={disabled}
                    />
                </div>
            )}
        </div>
    );
}
