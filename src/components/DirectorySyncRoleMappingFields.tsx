"use client";

import { HorizontalTabs } from "@app/components/HorizontalTabs";
import { Alert, AlertDescription } from "@app/components/ui/alert";
import { FormDescription, FormLabel } from "@app/components/ui/form";
import { Button } from "@app/components/ui/button";
import { CheckboxWithLabel } from "@app/components/ui/checkbox";
import { Input } from "@app/components/ui/input";
import { InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { ReactNode, useEffect } from "react";
import {
    createDirectoryGroupRoleRule,
    DirectoryGroupRoleRule,
    DirectorySyncRoleMappingConfig,
    DirectorySyncRoleMappingMode
} from "@app/lib/idpDirectorySyncRoleMapping";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { build } from "@server/build";
import { RolesSelector, SelectedRole } from "./roles-selector";

export type DirectorySyncRoleMappingFieldsProps = {
    value: DirectorySyncRoleMappingConfig;
    onChange: (value: DirectorySyncRoleMappingConfig) => void;
    orgId: string;
    /** Unique prefix for field ids when multiple instances exist on one page. */
    fieldIdPrefix?: string;
};

export default function DirectorySyncRoleMappingFields({
    value,
    onChange,
    orgId,
    fieldIdPrefix = "directory-sync-role-mapping"
}: DirectorySyncRoleMappingFieldsProps) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const { isPaidUser } = usePaidStatus();

    const supportsMultipleRolesPerUser = isPaidUser(tierMatrix.fullRbac);
    const showSingleRoleDisclaimer =
        !env.flags.disableEnterpriseFeatures &&
        !isPaidUser(tierMatrix.fullRbac);

    const { mode, fixedRoleNames, groupRules, createMissingRoles } = value;

    useEffect(() => {
        if (!supportsMultipleRolesPerUser && fixedRoleNames.length > 1) {
            onChange({ ...value, fixedRoleNames: [fixedRoleNames[0]] });
        }
    }, [supportsMultipleRolesPerUser, fixedRoleNames, value, onChange]);

    const selectRoleNames = (
        nextTags: SelectedRole[],
        current: string[]
    ): string[] => {
        let names = [...new Set(nextTags.map((tag) => tag.text))];
        if (!supportsMultipleRolesPerUser) {
            if (names.length === 0 && current.length > 0) {
                return [current[current.length - 1]!];
            }
            if (names.length > 1) {
                names = [names[names.length - 1]!];
            }
        }
        return names;
    };

    const setGroupRules = (rules: DirectoryGroupRoleRule[]) =>
        onChange({
            ...value,
            groupRules: rules.length ? rules : [createDirectoryGroupRoleRule()]
        });

    const modes: { value: DirectorySyncRoleMappingMode; label: string }[] = [
        {
            value: "automatic",
            label: t("directorySyncRoleMappingModeAutomatic")
        },
        {
            value: "groupMapping",
            label: t("directorySyncRoleMappingModeGroupMapping")
        },
        {
            value: "fixedRoles",
            label: t("directorySyncRoleMappingModeFixedRoles")
        }
    ];

    const groupRulesGridClass =
        "md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.75fr)_6rem] md:gap-x-3";

    const panels: Record<DirectorySyncRoleMappingMode, ReactNode> = {
        fixedRoles: (
            <div className="space-y-2 min-w-0 max-w-full">
                <RolesSelector
                    selectedRoles={fixedRoleNames.map((name) => ({
                        id: name,
                        text: name
                    }))}
                    mapRolesByName
                    orgId={orgId}
                    onSelectRoles={(nextTags) =>
                        onChange({
                            ...value,
                            fixedRoleNames: selectRoleNames(
                                nextTags,
                                fixedRoleNames
                            )
                        })
                    }
                />
                <FormDescription>
                    {t("directorySyncRoleMappingFixedRolesDescription")}
                </FormDescription>
            </div>
        ),
        groupMapping: (
            <div className="space-y-4 min-w-0 max-w-full">
                <div className="space-y-3">
                    <div
                        className={`hidden ${groupRulesGridClass} md:items-end`}
                    >
                        <FormLabel className="min-w-0">
                            {t("directorySyncRoleMappingGroup")}
                        </FormLabel>
                        <FormLabel className="min-w-0">
                            {t("roleMappingAssignRoles")}
                        </FormLabel>
                        <span aria-hidden className="min-w-0" />
                    </div>

                    {groupRules.map((rule, index) => (
                        <div
                            key={rule.id ?? `group-rule-${index}`}
                            className={`grid gap-3 min-w-0 ${groupRulesGridClass} md:items-start`}
                        >
                            <div className="space-y-1 min-w-0">
                                <FormLabel className="text-xs md:hidden">
                                    {t("directorySyncRoleMappingGroup")}
                                </FormLabel>
                                <Input
                                    id={`${fieldIdPrefix}-rule-${index}-group`}
                                    value={rule.group}
                                    onChange={(e) =>
                                        setGroupRules(
                                            groupRules.map((row, i) =>
                                                i === index
                                                    ? {
                                                          ...row,
                                                          group: e.target.value
                                                      }
                                                    : row
                                            )
                                        )
                                    }
                                    placeholder={t(
                                        "directorySyncRoleMappingGroupPlaceholder"
                                    )}
                                />
                            </div>
                            <div className="space-y-1 min-w-0 w-full max-w-full">
                                <FormLabel className="text-xs md:hidden">
                                    {t("roleMappingAssignRoles")}
                                </FormLabel>
                                <RolesSelector
                                    selectedRoles={rule.roleNames.map(
                                        (name) => ({ id: name, text: name })
                                    )}
                                    buttonText={t("roleMappingAssignRoles")}
                                    mapRolesByName
                                    orgId={orgId}
                                    onSelectRoles={(nextTags) =>
                                        setGroupRules(
                                            groupRules.map((row, i) =>
                                                i === index
                                                    ? {
                                                          ...row,
                                                          roleNames:
                                                              selectRoleNames(
                                                                  nextTags,
                                                                  row.roleNames
                                                              )
                                                      }
                                                    : row
                                            )
                                        )
                                    }
                                />
                            </div>
                            <div className="flex min-w-0 justify-end md:justify-start">
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="h-9 shrink-0 px-2"
                                    onClick={() =>
                                        setGroupRules(
                                            groupRules.filter(
                                                (_, i) => i !== index
                                            )
                                        )
                                    }
                                >
                                    {t("roleMappingRemoveRule")}
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>

                <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                        setGroupRules([
                            ...groupRules,
                            createDirectoryGroupRoleRule()
                        ])
                    }
                >
                    {t("directorySyncRoleMappingAddGroupRule")}
                </Button>
                <FormDescription>
                    {t("directorySyncRoleMappingGroupMappingDescription")}
                </FormDescription>
            </div>
        ),
        automatic: (
            <div className="space-y-2">
                <FormDescription>
                    {t("directorySyncRoleMappingAutomaticDescription")}
                </FormDescription>
                <CheckboxWithLabel
                    variant="outlinePrimarySquare"
                    id={`${fieldIdPrefix}-create-missing-roles`}
                    label={t("directorySyncRoleMappingCreateMissingRoles")}
                    checked={createMissingRoles}
                    onCheckedChange={(checked) =>
                        onChange({
                            ...value,
                            createMissingRoles: checked === true
                        })
                    }
                />
                <FormDescription>
                    {t("directorySyncRoleMappingCreateMissingRolesDescription")}
                </FormDescription>
            </div>
        )
    };

    const skipNotices: Partial<Record<DirectorySyncRoleMappingMode, string>> = {
        groupMapping: t("directorySyncRoleMappingGroupMappingSkipNotice"),
        automatic: createMissingRoles
            ? t("directorySyncRoleMappingAutomaticSkipNotice")
            : t("directorySyncRoleMappingAutomaticNoCreateSkipNotice")
    };

    const activeTab = Math.max(
        modes.findIndex((option) => option.value === mode),
        0
    );

    return (
        <div className="space-y-4">
            <div>
                {showSingleRoleDisclaimer && (
                    <FormDescription>
                        {build === "saas"
                            ? t("singleRolePerUserPlanNotice")
                            : t("singleRolePerUserEditionNotice")}
                    </FormDescription>
                )}
            </div>

            <HorizontalTabs
                clientSide
                items={modes.map((option) => ({
                    title: option.label,
                    href: "#"
                }))}
                activeTab={activeTab}
                onTabChange={(index) =>
                    onChange({ ...value, mode: modes[index]!.value })
                }
            >
                {modes.map((option) => (
                    <div key={option.value} className="space-y-4 mt-4 p-1">
                        <FormDescription className="mb-4">
                            {t("directorySyncRoleMappingDescription")}
                        </FormDescription>

                        {skipNotices[option.value] && (
                            <Alert variant="neutral">
                                <InfoIcon className="h-4 w-4" />
                                <AlertDescription>
                                    {skipNotices[option.value]}
                                </AlertDescription>
                            </Alert>
                        )}
                        {panels[option.value]}
                    </div>
                ))}
            </HorizontalTabs>
        </div>
    );
}
