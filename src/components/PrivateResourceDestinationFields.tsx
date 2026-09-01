"use client";

import { SettingsFormCell, SettingsFormGrid } from "@app/components/Settings";
import {
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { Input } from "@app/components/ui/input";
import { useTranslations } from "next-intl";
import type { Control, UseFormWatch } from "react-hook-form";

type PrivateResourceAliasFieldProps = {
    control: Control<any>;
    watch: UseFormWatch<any>;
    labelPrefix?: "create" | "edit";
    disabled?: boolean;
};

export function PrivateResourceAliasField({
    control,
    watch,
    labelPrefix = "edit",
    disabled = false
}: PrivateResourceAliasFieldProps) {
    const t = useTranslations();
    const aliasLabelKey =
        labelPrefix === "create"
            ? "createInternalResourceDialogAlias"
            : "editInternalResourceDialogAlias";
    const aliasDescriptionKey =
        labelPrefix === "create"
            ? "createInternalResourceDialogAliasDescription"
            : "editInternalResourceDialogAliasDescription";

    const aliasValue = watch("alias");
    const aliasEndsWithLocal =
        typeof aliasValue === "string" &&
        aliasValue.trim().toLowerCase().endsWith(".local");

    return (
        <FormField
            control={control}
            name="alias"
            render={({ field }) => (
                <FormItem>
                    <FormLabel>{t(aliasLabelKey)}</FormLabel>
                    <FormControl>
                        <Input
                            {...field}
                            className="w-full"
                            value={field.value ?? ""}
                            disabled={disabled}
                        />
                    </FormControl>
                    {aliasEndsWithLocal && (
                        <p className="text-xs text-amber-700/80 mt-1">
                            {t("internalResourceAliasLocalWarning")}
                        </p>
                    )}
                    <FormMessage />
                    <FormDescription>{t(aliasDescriptionKey)}</FormDescription>
                </FormItem>
            )}
        />
    );
}

type PrivateResourceHostDestinationFieldsProps = {
    control: Control<any>;
    watch: UseFormWatch<any>;
    labelPrefix?: "create" | "edit";
    hideAlias?: boolean;
};

type PrivateResourceInferenceDestinationFieldsProps = {
    control: Control<any>;
    watch: UseFormWatch<any>;
    labelPrefix?: "create" | "edit";
    hideAlias?: boolean;
};

export function PrivateResourceInferenceDestinationFields({
    control,
    watch,
    labelPrefix = "edit"
}: PrivateResourceInferenceDestinationFieldsProps) {
    const t = useTranslations();
    const destinationLabelKey =
        labelPrefix === "create"
            ? "createInternalResourceDialogDestination"
            : "editInternalResourceDialogDestination";

    return (
        <SettingsFormGrid>
            <SettingsFormCell span="half">
                <PrivateResourceAliasField
                    control={control}
                    watch={watch}
                    labelPrefix={labelPrefix}
                />
            </SettingsFormCell>
        </SettingsFormGrid>
    );
}

export function PrivateResourceHostDestinationFields({
    control,
    watch,
    labelPrefix = "edit",
    hideAlias = false
}: PrivateResourceHostDestinationFieldsProps) {
    const t = useTranslations();
    const destinationLabelKey =
        labelPrefix === "create"
            ? "createInternalResourceDialogDestination"
            : "editInternalResourceDialogDestination";

    const destinationField = (
        <FormField
            control={control}
            name="destination"
            render={({ field }) => (
                <FormItem>
                    <FormLabel>{t(destinationLabelKey)}</FormLabel>
                    <FormControl>
                        <Input
                            {...field}
                            className="w-full"
                            value={field.value ?? ""}
                            onChange={(e) =>
                                field.onChange(
                                    e.target.value === ""
                                        ? null
                                        : e.target.value
                                )
                            }
                        />
                    </FormControl>
                    <FormMessage />
                </FormItem>
            )}
        />
    );

    if (hideAlias) {
        return destinationField;
    }

    return (
        <SettingsFormGrid>
            <SettingsFormCell span="half">{destinationField}</SettingsFormCell>
            <SettingsFormCell span="half">
                <PrivateResourceAliasField
                    control={control}
                    watch={watch}
                    labelPrefix={labelPrefix}
                />
            </SettingsFormCell>
        </SettingsFormGrid>
    );
}

export function PrivateResourceCidrDestinationField({
    control,
    labelPrefix = "edit"
}: {
    control: Control<any>;
    labelPrefix?: "create" | "edit";
}) {
    const t = useTranslations();
    const destinationLabelKey =
        labelPrefix === "create"
            ? "createInternalResourceDialogDestination"
            : "editInternalResourceDialogDestination";

    return (
        <FormField
            control={control}
            name="destination"
            render={({ field }) => (
                <FormItem>
                    <FormLabel>{t(destinationLabelKey)}</FormLabel>
                    <FormControl>
                        <Input
                            {...field}
                            className="w-full"
                            value={field.value ?? ""}
                            onChange={(e) =>
                                field.onChange(
                                    e.target.value === ""
                                        ? null
                                        : e.target.value
                                )
                            }
                        />
                    </FormControl>
                    <FormMessage />
                </FormItem>
            )}
        />
    );
}
