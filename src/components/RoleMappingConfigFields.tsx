"use client";

import { FormLabel, FormDescription } from "@app/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@app/components/ui/radio-group";
import { Button } from "@app/components/ui/button";
import { Input } from "@app/components/ui/input";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Tag, TagInput } from "@app/components/tags/tag-input";
import { CheckboxWithLabel } from "@app/components/ui/checkbox";
import {
    createMappingBuilderRule,
    MappingBuilderRule,
    RoleMappingMode
} from "@app/lib/idpRoleMapping";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { build } from "@server/build";
import { RolesSelector } from "./roles-selector";

export type RoleMappingRoleOption = {
    roleId: number;
    name: string;
};

export type RoleMappingConfigFieldsProps = {
    roleMappingMode: RoleMappingMode;
    onRoleMappingModeChange: (mode: RoleMappingMode) => void;
    roles: RoleMappingRoleOption[];
    fixedRoleNames: string[];
    onFixedRoleNamesChange: (roleNames: string[]) => void;
    mappingBuilderClaimPath: string;
    onMappingBuilderClaimPathChange: (claimPath: string) => void;
    mappingBuilderRules: MappingBuilderRule[];
    onMappingBuilderRulesChange: (rules: MappingBuilderRule[]) => void;
    rawExpression: string;
    onRawExpressionChange: (expression: string) => void;
    /** Unique prefix for radio `id`/`htmlFor` when multiple instances exist on one page. */
    fieldIdPrefix?: string;
    /** When true, show extra hint for global default policies (no org role list). */
    showFreeformRoleNamesHint?: boolean;
    /** Org ID to use for role lookup. Falls back to URL params when not provided. */
    orgId?: string;
    /**
     * "Create missing roles" checkbox, hidden when the handler is omitted. Only
     * shown for a raw expression, the only mode that can return roles that
     * aren't in the org.
     */
    createMissingRoles?: boolean;
    onCreateMissingRolesChange?: (checked: boolean) => void;
};

export default function RoleMappingConfigFields({
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
    fieldIdPrefix = "role-mapping",
    showFreeformRoleNamesHint = false,
    orgId,
    createMissingRoles = false,
    onCreateMissingRolesChange
}: RoleMappingConfigFieldsProps) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const { isPaidUser } = usePaidStatus();

    const supportsMultipleRolesPerUser = isPaidUser(tierMatrix.fullRbac);
    const showSingleRoleDisclaimer =
        !env.flags.disableEnterpriseFeatures &&
        !isPaidUser(tierMatrix.fullRbac);

    const restrictToOrgRoles = roles.length > 0;

    const roleOptions = useMemo(
        () =>
            roles.map((role) => ({
                id: role.name,
                text: role.name
            })),
        [roles]
    );

    useEffect(() => {
        if (!supportsMultipleRolesPerUser && mappingBuilderRules.length > 1) {
            onMappingBuilderRulesChange([mappingBuilderRules[0]]);
        }
    }, [
        supportsMultipleRolesPerUser,
        mappingBuilderRules,
        onMappingBuilderRulesChange
    ]);

    useEffect(() => {
        if (!supportsMultipleRolesPerUser && fixedRoleNames.length > 1) {
            onFixedRoleNamesChange([fixedRoleNames[0]]);
        }
    }, [supportsMultipleRolesPerUser, fixedRoleNames, onFixedRoleNamesChange]);

    const [fixedRolesActiveTagIndex, setFixedRolesActiveTagIndex] = useState<
        number | null
    >(null);

    const fixedRadioId = `${fieldIdPrefix}-fixed-roles-mode`;
    const builderRadioId = `${fieldIdPrefix}-mapping-builder-mode`;
    const rawRadioId = `${fieldIdPrefix}-raw-expression-mode`;

    const mappingBuilderShowsRemoveColumn =
        supportsMultipleRolesPerUser || mappingBuilderRules.length > 1;

    /** Same template on header + rows so 1fr/1.75fr columns line up (auto third col differs per row otherwise). */
    const mappingRulesGridClass = mappingBuilderShowsRemoveColumn
        ? "md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.75fr)_6rem] md:gap-x-3"
        : "md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.75fr)] md:gap-x-3";

    return (
        <div className="space-y-4">
            <div>
                <FormDescription className="mb-4">
                    {t("roleMappingDescription")}
                </FormDescription>

                <RadioGroup
                    value={roleMappingMode}
                    onValueChange={onRoleMappingModeChange}
                    className="flex flex-wrap gap-x-6 gap-y-2"
                >
                    <div className="flex items-center space-x-2">
                        <RadioGroupItem value="fixedRoles" id={fixedRadioId} />
                        <label
                            htmlFor={fixedRadioId}
                            className="text-sm font-medium"
                        >
                            {t("roleMappingModeFixedRoles")}
                        </label>
                    </div>
                    <div className="flex items-center space-x-2">
                        <RadioGroupItem
                            value="mappingBuilder"
                            id={builderRadioId}
                        />
                        <label
                            htmlFor={builderRadioId}
                            className="text-sm font-medium"
                        >
                            {t("roleMappingModeMappingBuilder")}
                        </label>
                    </div>
                    <div className="flex items-center space-x-2">
                        <RadioGroupItem value="rawExpression" id={rawRadioId} />
                        <label
                            htmlFor={rawRadioId}
                            className="text-sm font-medium"
                        >
                            {t("roleMappingModeRawExpression")}
                        </label>
                    </div>
                </RadioGroup>
                {showSingleRoleDisclaimer && (
                    <FormDescription className="mt-3">
                        {build === "saas"
                            ? t("singleRolePerUserPlanNotice")
                            : t("singleRolePerUserEditionNotice")}
                    </FormDescription>
                )}
            </div>

            {roleMappingMode === "fixedRoles" && (
                <div className="space-y-2 min-w-0 max-w-full">
                    {restrictToOrgRoles ? (
                        <RolesSelector
                            selectedRoles={fixedRoleNames.map((name) => ({
                                id: name,
                                text: name
                            }))}
                            mapRolesByName
                            orgId={orgId as string}
                            onSelectRoles={(nextTags) => {
                                let names = [
                                    ...new Set(nextTags.map((tag) => tag.text))
                                ];

                                if (!supportsMultipleRolesPerUser) {
                                    if (
                                        names.length === 0 &&
                                        fixedRoleNames.length > 0
                                    ) {
                                        onFixedRoleNamesChange([
                                            fixedRoleNames[
                                                fixedRoleNames.length - 1
                                            ]!
                                        ]);
                                        return;
                                    }
                                    if (names.length > 1) {
                                        names = [names[names.length - 1]!];
                                    }
                                }

                                onFixedRoleNamesChange(names);
                            }}
                        />
                    ) : (
                        <TagInput
                            tags={fixedRoleNames.map((name) => ({
                                id: name,
                                text: name
                            }))}
                            setTags={(nextTags) => {
                                const prev = fixedRoleNames.map((name) => ({
                                    id: name,
                                    text: name
                                }));
                                const next =
                                    typeof nextTags === "function"
                                        ? nextTags(prev)
                                        : nextTags;

                                let names = [
                                    ...new Set(next.map((tag) => tag.text))
                                ];

                                if (!supportsMultipleRolesPerUser) {
                                    if (
                                        names.length === 0 &&
                                        fixedRoleNames.length > 0
                                    ) {
                                        onFixedRoleNamesChange([
                                            fixedRoleNames[
                                                fixedRoleNames.length - 1
                                            ]!
                                        ]);
                                        return;
                                    }
                                    if (names.length > 1) {
                                        names = [names[names.length - 1]!];
                                    }
                                }

                                onFixedRoleNamesChange(names);
                            }}
                            activeTagIndex={fixedRolesActiveTagIndex}
                            setActiveTagIndex={setFixedRolesActiveTagIndex}
                            placeholder={t(
                                "roleMappingAssignRolesPlaceholderFreeform"
                            )}
                            enableAutocomplete={false}
                            autocompleteOptions={roleOptions}
                            restrictTagsToAutocompleteOptions={false}
                            allowDuplicates={false}
                            sortTags={true}
                            size="sm"
                            styleClasses={{
                                inlineTagsContainer: "min-w-0 max-w-full"
                            }}
                        />
                    )}
                    <FormDescription>
                        {showFreeformRoleNamesHint
                            ? t("roleMappingFixedRolesDescriptionDefaultPolicy")
                            : t("roleMappingFixedRolesDescriptionSameForAll")}
                    </FormDescription>
                </div>
            )}

            {roleMappingMode === "mappingBuilder" && (
                <div className="space-y-4 min-w-0 max-w-full">
                    <div className="space-y-2">
                        <FormLabel>{t("roleMappingClaimPath")}</FormLabel>
                        <Input
                            value={mappingBuilderClaimPath}
                            onChange={(e) =>
                                onMappingBuilderClaimPathChange(e.target.value)
                            }
                            placeholder={t("roleMappingClaimPathPlaceholder")}
                        />
                        <FormDescription>
                            {t("roleMappingClaimPathDescription")}
                        </FormDescription>
                    </div>

                    <div className="space-y-3">
                        <div
                            className={`hidden ${mappingRulesGridClass} md:items-end`}
                        >
                            <FormLabel className="min-w-0">
                                {t("roleMappingMatchValue")}
                            </FormLabel>
                            <FormLabel className="min-w-0">
                                {t("roleMappingAssignRoles")}
                            </FormLabel>
                            {mappingBuilderShowsRemoveColumn ? (
                                <span aria-hidden className="min-w-0" />
                            ) : null}
                        </div>

                        {mappingBuilderRules.map((rule, index) => (
                            <BuilderRuleRow
                                key={rule.id ?? `mapping-rule-${index}`}
                                mappingRulesGridClass={mappingRulesGridClass}
                                fieldIdPrefix={`${fieldIdPrefix}-rule-${index}`}
                                roleOptions={roleOptions}
                                restrictToOrgRoles={restrictToOrgRoles}
                                showFreeformRoleNamesHint={
                                    showFreeformRoleNamesHint
                                }
                                orgId={orgId}
                                supportsMultipleRolesPerUser={
                                    supportsMultipleRolesPerUser
                                }
                                showRemoveButton={
                                    mappingBuilderShowsRemoveColumn
                                }
                                rule={rule}
                                onChange={(nextRule) => {
                                    const nextRules = mappingBuilderRules.map(
                                        (row, i) =>
                                            i === index ? nextRule : row
                                    );
                                    onMappingBuilderRulesChange(nextRules);
                                }}
                                onRemove={() => {
                                    const nextRules =
                                        mappingBuilderRules.filter(
                                            (_, i) => i !== index
                                        );
                                    onMappingBuilderRulesChange(
                                        nextRules.length
                                            ? nextRules
                                            : [createMappingBuilderRule()]
                                    );
                                }}
                            />
                        ))}
                    </div>

                    {supportsMultipleRolesPerUser ? (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                                onMappingBuilderRulesChange([
                                    ...mappingBuilderRules,
                                    createMappingBuilderRule()
                                ]);
                            }}
                        >
                            {t("roleMappingAddMappingRule")}
                        </Button>
                    ) : null}
                </div>
            )}

            {roleMappingMode === "rawExpression" && (
                <div className="space-y-2">
                    <Input
                        value={rawExpression}
                        onChange={(e) => onRawExpressionChange(e.target.value)}
                        placeholder={t("roleMappingExpressionPlaceholder")}
                    />
                    <FormDescription>
                        {supportsMultipleRolesPerUser
                            ? t("roleMappingRawExpressionResultDescription")
                            : t(
                                  "roleMappingRawExpressionResultDescriptionSingleRole"
                              )}
                    </FormDescription>
                </div>
            )}

            {onCreateMissingRolesChange &&
                roleMappingMode === "rawExpression" && (
                    <div className="space-y-1">
                        <CheckboxWithLabel
                            id={`${fieldIdPrefix}-create-missing-roles`}
                            label={t("roleMappingCreateMissingRoles")}
                            checked={createMissingRoles}
                            onCheckedChange={(checked) =>
                                onCreateMissingRolesChange(checked === true)
                            }
                        />
                        <FormDescription>
                            {t("roleMappingCreateMissingRolesDescription")}
                        </FormDescription>
                    </div>
                )}
        </div>
    );
}

function BuilderRuleRow({
    rule,
    roleOptions,
    restrictToOrgRoles,
    showFreeformRoleNamesHint,
    fieldIdPrefix,
    mappingRulesGridClass,
    supportsMultipleRolesPerUser,
    showRemoveButton,
    onChange,
    onRemove,
    orgId
}: {
    rule: MappingBuilderRule;
    roleOptions: Tag[];
    restrictToOrgRoles: boolean;
    showFreeformRoleNamesHint: boolean;
    fieldIdPrefix: string;
    mappingRulesGridClass: string;
    supportsMultipleRolesPerUser: boolean;
    showRemoveButton: boolean;
    onChange: (rule: MappingBuilderRule) => void;
    onRemove: () => void;
    orgId?: string;
}) {
    const t = useTranslations();
    const [activeTagIndex, setActiveTagIndex] = useState<number | null>(null);

    return (
        <div
            className={`grid gap-3 min-w-0 ${mappingRulesGridClass} md:items-start`}
        >
            <div className="space-y-1 min-w-0">
                <FormLabel className="text-xs md:hidden">
                    {t("roleMappingMatchValue")}
                </FormLabel>
                <Input
                    id={`${fieldIdPrefix}-match`}
                    value={rule.matchValue}
                    onChange={(e) =>
                        onChange({
                            ...rule,
                            matchValue: e.target.value
                        })
                    }
                    placeholder={t("roleMappingMatchValuePlaceholder")}
                />
            </div>
            <div className="space-y-1 min-w-0 w-full max-w-full">
                <FormLabel className="text-xs md:hidden">
                    {t("roleMappingAssignRoles")}
                </FormLabel>
                <div className="min-w-0 max-w-full">
                    {restrictToOrgRoles ? (
                        <RolesSelector
                            selectedRoles={rule.roleNames.map((name) => ({
                                id: name,
                                text: name
                            }))}
                            buttonText={t("roleMappingAssignRoles")}
                            mapRolesByName
                            orgId={orgId as string}
                            onSelectRoles={(nextTags) => {
                                let names = [
                                    ...new Set(nextTags.map((tag) => tag.text))
                                ];

                                if (!supportsMultipleRolesPerUser) {
                                    if (
                                        names.length === 0 &&
                                        rule.roleNames.length > 0
                                    ) {
                                        onChange({
                                            ...rule,
                                            roleNames: [
                                                rule.roleNames[
                                                    rule.roleNames.length - 1
                                                ]!
                                            ]
                                        });
                                        return;
                                    }
                                    if (names.length > 1) {
                                        names = [names[names.length - 1]!];
                                    }
                                }

                                onChange({
                                    ...rule,
                                    roleNames: names
                                });
                            }}
                        />
                    ) : (
                        <TagInput
                            tags={rule.roleNames.map((name) => ({
                                id: name,
                                text: name
                            }))}
                            setTags={(nextTags) => {
                                const prevRoleTags = rule.roleNames.map(
                                    (name) => ({
                                        id: name,
                                        text: name
                                    })
                                );
                                const next =
                                    typeof nextTags === "function"
                                        ? nextTags(prevRoleTags)
                                        : nextTags;

                                let names = [
                                    ...new Set(next.map((tag) => tag.text))
                                ];

                                if (!supportsMultipleRolesPerUser) {
                                    if (
                                        names.length === 0 &&
                                        rule.roleNames.length > 0
                                    ) {
                                        onChange({
                                            ...rule,
                                            roleNames: [
                                                rule.roleNames[
                                                    rule.roleNames.length - 1
                                                ]!
                                            ]
                                        });
                                        return;
                                    }
                                    if (names.length > 1) {
                                        names = [names[names.length - 1]!];
                                    }
                                }

                                onChange({
                                    ...rule,
                                    roleNames: names
                                });
                            }}
                            activeTagIndex={activeTagIndex}
                            setActiveTagIndex={setActiveTagIndex}
                            placeholder={t(
                                "roleMappingAssignRolesPlaceholderFreeform"
                            )}
                            enableAutocomplete={false}
                            autocompleteOptions={roleOptions}
                            restrictTagsToAutocompleteOptions={false}
                            allowDuplicates={false}
                            sortTags={true}
                            size="sm"
                            styleClasses={{
                                inlineTagsContainer: "min-w-0 max-w-full"
                            }}
                        />
                    )}
                </div>
                {showFreeformRoleNamesHint && (
                    <p className="text-sm text-muted-foreground">
                        {t("roleMappingBuilderFreeformRowHint")}
                    </p>
                )}
            </div>
            {showRemoveButton ? (
                <div className="flex min-w-0 justify-end md:justify-start md:pt-0">
                    <Button
                        type="button"
                        variant="outline"
                        className="h-9 shrink-0 px-2"
                        onClick={onRemove}
                    >
                        {t("roleMappingRemoveRule")}
                    </Button>
                </div>
            ) : null}
        </div>
    );
}
