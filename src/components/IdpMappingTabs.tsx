"use client";

import { HorizontalTabs } from "@app/components/HorizontalTabs";
import IdpMappingTestButton from "@app/components/idp/IdpMappingTestButton";
import RoleMappingConfigFields, {
    RoleMappingRoleOption
} from "@app/components/RoleMappingConfigFields";
import {
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { Input } from "@app/components/ui/input";
import { RoleMappingConfig } from "@app/lib/idpRoleMapping";
import { useTranslations } from "next-intl";
import type { Dispatch, SetStateAction } from "react";
import type { Control } from "react-hook-form";

type IdpMappingTabsProps = {
    roleMapping: RoleMappingConfig;
    /** Functional updates: the editor can fire several changes in one render. */
    onRoleMappingChange: Dispatch<SetStateAction<RoleMappingConfig>>;
    roles: RoleMappingRoleOption[];
    /**
     * Form field holding the org mapping expression. Omit it for org IdPs: the org
     * is fixed, so only the role mapping is shown.
     */
    orgMappingField?: { control: unknown; name: string; labelKey?: string };
    /** Org whose roles are offered. Omit for global defaults (free-form role names). */
    orgId?: string;
    fieldIdPrefix: string;
    showFreeformRoleNamesHint?: boolean;
    /** "Create missing roles" checkbox, only shown for a raw expression unless `createMissingRolesInAnyMode`. */
    createMissingRoles?: boolean;
    onCreateMissingRolesChange?: (checked: boolean) => void;
    createMissingRolesInAnyMode?: boolean;
    /**
     * `/idp/:idpId` or `/org/:orgId/idp/:idpId`: the mapping playground prefills
     * the claims of this IdP's latest completed test link.
     */
    testResultsApiBase?: string;
};

/** Role mapping (and optionally org mapping) editors, used for JIT, sync, or both when the mappings are linked. */
export default function IdpMappingTabs({
    roleMapping,
    onRoleMappingChange,
    roles,
    orgMappingField,
    orgId,
    fieldIdPrefix,
    showFreeformRoleNamesHint,
    createMissingRoles,
    onCreateMissingRolesChange,
    createMissingRolesInAnyMode,
    testResultsApiBase
}: IdpMappingTabsProps) {
    const t = useTranslations();

    const testButton = (
        <div className="flex justify-end p-1">
            <IdpMappingTestButton
                testResultsApiBase={testResultsApiBase}
                orgId={orgId}
                roles={roles}
                roleMapping={roleMapping}
                orgMappingField={orgMappingField}
            />
        </div>
    );

    const roleMappingFields = (
        <div className="space-y-4 mt-4 p-1">
            <RoleMappingConfigFields
                fieldIdPrefix={fieldIdPrefix}
                showFreeformRoleNamesHint={showFreeformRoleNamesHint}
                orgId={orgId}
                roles={roles}
                roleMappingMode={roleMapping.mode}
                onRoleMappingModeChange={(mode) =>
                    onRoleMappingChange((prev) => ({ ...prev, mode }))
                }
                fixedRoleNames={roleMapping.fixedRoleNames}
                onFixedRoleNamesChange={(fixedRoleNames) =>
                    onRoleMappingChange((prev) => ({
                        ...prev,
                        fixedRoleNames
                    }))
                }
                mappingBuilderClaimPath={roleMapping.mappingBuilder.claimPath}
                onMappingBuilderClaimPathChange={(claimPath) =>
                    onRoleMappingChange((prev) => ({
                        ...prev,
                        mappingBuilder: { ...prev.mappingBuilder, claimPath }
                    }))
                }
                mappingBuilderRules={roleMapping.mappingBuilder.rules}
                onMappingBuilderRulesChange={(rules) =>
                    onRoleMappingChange((prev) => ({
                        ...prev,
                        mappingBuilder: { ...prev.mappingBuilder, rules }
                    }))
                }
                rawExpression={roleMapping.rawExpression}
                onRawExpressionChange={(rawExpression) =>
                    onRoleMappingChange((prev) => ({
                        ...prev,
                        rawExpression
                    }))
                }
                createMissingRoles={createMissingRoles}
                onCreateMissingRolesChange={onCreateMissingRolesChange}
                createMissingRolesInAnyMode={createMissingRolesInAnyMode}
            />
        </div>
    );

    if (!orgMappingField) {
        return (
            <div className="space-y-2">
                {roleMappingFields}
                {testButton}
            </div>
        );
    }

    return (
        <div className="space-y-2">
            <HorizontalTabs
                clientSide
                defaultTab={0}
                items={[
                    { title: t("roleMapping"), href: "#" },
                    { title: t("orgMapping"), href: "#" }
                ]}
            >
                {roleMappingFields}
                <div className="space-y-4 mt-4 p-1">
                    <p className="text-sm text-muted-foreground">
                        {t("defaultMappingsOrgDescription")}
                    </p>
                    <FormField
                        control={orgMappingField.control as Control<any>}
                        name={orgMappingField.name}
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>
                                    {t(
                                        orgMappingField.labelKey ??
                                            "orgMappingPathOptional"
                                    )}
                                </FormLabel>
                                <FormControl>
                                    <Input
                                        {...field}
                                        value={field.value ?? ""}
                                        placeholder="e.g., ends_with(email, '@organization.com')"
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>
            </HorizontalTabs>
            {testButton}
        </div>
    );
}
