"use client";

import { HorizontalTabs } from "@app/components/HorizontalTabs";
import RoleMappingConfigFields from "@app/components/RoleMappingConfigFields";
import { SwitchInput } from "@app/components/SwitchInput";
import {
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { Input } from "@app/components/ui/input";
import { MappingBuilderRule, RoleMappingMode } from "@app/lib/idpRoleMapping";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { useTranslations } from "next-intl";
import type { Control } from "react-hook-form";

type Role = {
    roleId: number;
    name: string;
};

export type IdpOrgMappingFieldBinding = {
    control: unknown;
    name: string;
    labelKey?: string;
};

type AutoProvisionConfigWidgetProps = {
    autoProvision: boolean;
    onAutoProvisionChange: (checked: boolean) => void;
    roleMappingMode: RoleMappingMode;
    onRoleMappingModeChange: (mode: RoleMappingMode) => void;
    roles: Role[];
    fixedRoleNames: string[];
    onFixedRoleNamesChange: (roleNames: string[]) => void;
    mappingBuilderClaimPath: string;
    onMappingBuilderClaimPathChange: (claimPath: string) => void;
    mappingBuilderRules: MappingBuilderRule[];
    onMappingBuilderRulesChange: (rules: MappingBuilderRule[]) => void;
    rawExpression: string;
    onRawExpressionChange: (expression: string) => void;
    orgMappingField: IdpOrgMappingFieldBinding;
    showAutoProvisionSwitch?: boolean;
    roleMappingFieldIdPrefix?: string;
    showFreeformRoleNamesHint?: boolean;
    autoProvisionSwitchId?: string;
    orgId?: string;
};

export default function AutoProvisionConfigWidget({
    autoProvision,
    onAutoProvisionChange,
    roleMappingMode,
    onRoleMappingModeChange,
    roles,
    fixedRoleNames,
    onFixedRoleNamesChange,
    mappingBuilderClaimPath,
    onMappingBuilderClaimPathChange,
    mappingBuilderRules,
    onMappingBuilderRulesChange,
    rawExpression,
    onRawExpressionChange,
    orgMappingField,
    showAutoProvisionSwitch = true,
    roleMappingFieldIdPrefix = "org-idp-auto-provision",
    showFreeformRoleNamesHint = false,
    autoProvisionSwitchId = "auto-provision-toggle",
    orgId
}: AutoProvisionConfigWidgetProps) {
    const t = useTranslations();
    const { isPaidUser } = usePaidStatus();

    const showMappingTabs = showAutoProvisionSwitch === false || autoProvision;

    const orgMappingLabelKey =
        orgMappingField.labelKey ?? "orgMappingPathOptional";

    return (
        <div className="space-y-4">
            {showAutoProvisionSwitch && (
                <div className="mb-4">
                    <SwitchInput
                        id={autoProvisionSwitchId}
                        label={t("idpAutoProvisionUsers")}
                        checked={autoProvision}
                        onCheckedChange={onAutoProvisionChange}
                        disabled={!isPaidUser(tierMatrix.autoProvisioning)}
                    />
                </div>
            )}

            {showMappingTabs && (
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
                            fieldIdPrefix={roleMappingFieldIdPrefix}
                            showFreeformRoleNamesHint={
                                showFreeformRoleNamesHint
                            }
                            orgId={orgId}
                            roleMappingMode={roleMappingMode}
                            onRoleMappingModeChange={onRoleMappingModeChange}
                            roles={roles}
                            fixedRoleNames={fixedRoleNames}
                            onFixedRoleNamesChange={onFixedRoleNamesChange}
                            mappingBuilderClaimPath={mappingBuilderClaimPath}
                            onMappingBuilderClaimPathChange={
                                onMappingBuilderClaimPathChange
                            }
                            mappingBuilderRules={mappingBuilderRules}
                            onMappingBuilderRulesChange={
                                onMappingBuilderRulesChange
                            }
                            rawExpression={rawExpression}
                            onRawExpressionChange={onRawExpressionChange}
                        />
                    </div>
                    <div className="space-y-4 mt-4 p-1">
                        <div className="space-y-4">
                            <p className="text-sm text-muted-foreground">
                                {t("defaultMappingsOrgDescription")}
                            </p>
                            <FormField
                                control={
                                    orgMappingField.control as Control<any>
                                }
                                name={orgMappingField.name}
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>
                                            {t(orgMappingLabelKey)}
                                        </FormLabel>
                                        <FormControl>
                                            <Input
                                                {...field}
                                                placeholder="e.g., ends_with(email, '@organization.com')"
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                    </div>
                </HorizontalTabs>
            )}
        </div>
    );
}
