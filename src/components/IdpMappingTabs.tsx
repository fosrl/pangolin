"use client";

import { HorizontalTabs } from "@app/components/HorizontalTabs";
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
    /** Form field holding the org mapping expression. */
    orgMappingField: { control: unknown; name: string };
    orgId: string;
    fieldIdPrefix: string;
};

/** Role mapping and org mapping editors, used for JIT, sync, or both when the mappings are linked. */
export default function IdpMappingTabs({
    roleMapping,
    onRoleMappingChange,
    roles,
    orgMappingField,
    orgId,
    fieldIdPrefix
}: IdpMappingTabsProps) {
    const t = useTranslations();

    return (
        <HorizontalTabs
            clientSide
            defaultTab={0}
            items={[
                { title: t("roleMapping"), href: "#" },
                { title: t("orgMapping"), href: "#" }
            ]}
        >
            <div className="space-y-4 mt-4 p-1">
                <RoleMappingConfigFields
                    fieldIdPrefix={fieldIdPrefix}
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
                    mappingBuilderClaimPath={
                        roleMapping.mappingBuilder.claimPath
                    }
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
                />
            </div>
            <div className="space-y-4 mt-4 p-1">
                <p className="text-sm text-muted-foreground">
                    {t("defaultMappingsOrgDescription")}
                </p>
                <FormField
                    control={orgMappingField.control as Control<any>}
                    name={orgMappingField.name}
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>{t("orgMappingPathOptional")}</FormLabel>
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
    );
}
