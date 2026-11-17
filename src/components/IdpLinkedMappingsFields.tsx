"use client";

import IdpMappingTabs from "@app/components/IdpMappingTabs";
import { RoleMappingRoleOption } from "@app/components/RoleMappingConfigFields";
import { SwitchInput } from "@app/components/SwitchInput";
import { RoleMappingConfig } from "@app/lib/idpRoleMapping";
import { useTranslations } from "next-intl";
import type { Dispatch, SetStateAction } from "react";
import { Separator } from "./ui/separator";
import { Alert, AlertDescription } from "@app/components/ui/alert";
import { AlertTriangle } from "lucide-react";

export type IdpMappingSet = {
    roleMapping: RoleMappingConfig;
    onRoleMappingChange: Dispatch<SetStateAction<RoleMappingConfig>>;
    orgMappingField: { control: unknown; name: string; labelKey?: string };
    createMissingRoles: boolean;
    onCreateMissingRolesChange: (checked: boolean) => void;
};

type IdpLinkedMappingsFieldsProps = {
    /** Directory sync is on (google/azure only). When false, only the JIT editor is shown, without the switch. */
    syncAvailable: boolean;
    linked: boolean;
    /** Called with the new value; the caller copies the JIT mappings to sync when unlinking. */
    onLinkedChange: (linked: boolean) => void;
    jit: IdpMappingSet;
    sync: IdpMappingSet;
    roles: RoleMappingRoleOption[];
    orgId?: string;
    fieldIdPrefix: string;
    showFreeformRoleNamesHint?: boolean;
};

/**
 * Global IdP mappings (defaults or one org policy). While linked, one editor
 * (the JIT state) is saved to both JIT and sync.
 */
export default function IdpLinkedMappingsFields({
    syncAvailable,
    linked,
    onLinkedChange,
    jit,
    sync,
    roles,
    orgId,
    fieldIdPrefix,
    showFreeformRoleNamesHint
}: IdpLinkedMappingsFieldsProps) {
    const t = useTranslations();

    const renderTabs = (set: IdpMappingSet, prefix: string) => (
        <IdpMappingTabs
            fieldIdPrefix={prefix}
            orgId={orgId}
            roles={roles}
            showFreeformRoleNamesHint={showFreeformRoleNamesHint}
            roleMapping={set.roleMapping}
            onRoleMappingChange={set.onRoleMappingChange}
            orgMappingField={set.orgMappingField}
            createMissingRoles={set.createMissingRoles}
            onCreateMissingRolesChange={set.onCreateMissingRolesChange}
            createMissingRolesInAnyMode
        />
    );

    if (!syncAvailable) {
        return renderTabs(jit, fieldIdPrefix);
    }

    return (
        <div className="space-y-4">
            <SwitchInput
                id={`${fieldIdPrefix}-mappings-separate-toggle`}
                label={t("idpMappingsSeparate")}
                description={t("idpMappingsSeparateDescription")}
                checked={!linked}
                onCheckedChange={(separate) => onLinkedChange(!separate)}
            />

            {linked ? (
                renderTabs(jit, fieldIdPrefix)
            ) : (
                <>
                    <Alert variant="warning">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                            {t("idpMappingsSeparateWarning")}
                        </AlertDescription>
                    </Alert>
                    <Separator className="mt-5 mb-10" />
                    <div className="space-y-2">
                        <h4 className="text-sm font-medium">
                            {t("idpMappingsJit")}
                        </h4>
                        {renderTabs(jit, `${fieldIdPrefix}-jit`)}
                    </div>
                    <Separator className="mt-5 mb-10" />
                    <div className="space-y-2">
                        <h4 className="text-sm font-medium">
                            {t("idpMappingsSync")}
                        </h4>
                        {renderTabs(sync, `${fieldIdPrefix}-sync`)}
                    </div>
                </>
            )}
        </div>
    );
}
