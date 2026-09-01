"use client";

import {
    SettingsFormCell,
    SettingsFormGrid,
    SettingsSubsectionDescription,
    SettingsSubsectionHeader,
    SettingsSubsectionTitle
} from "@app/components/Settings";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { SshServerSettingsFields } from "@app/components/SshServerSettingsFields";
import { PrivateResourceAliasField } from "@app/components/PrivateResourceDestinationFields";
import { PrivateResourceSitesField } from "@app/components/PrivateResourceSitesField";
import { inferSshPamMode } from "@app/lib/privateResourceForm";
import { getSshUseMultiSiteTargetForm } from "@app/lib/privateResourceUtils";
import {
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { Input } from "@app/components/ui/input";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import type { Control, UseFormSetValue, UseFormWatch } from "react-hook-form";
import type { Selectedsite } from "@app/components/site-selector";

type PrivateResourceSshFieldsProps = {
    control: Control<any>;
    setValue: UseFormSetValue<any>;
    watch: UseFormWatch<any>;
    orgId?: string;
    disabled?: boolean;
    selectedSites: Selectedsite[];
    onSelectedSitesChange: (sites: Selectedsite[]) => void;
    labelPrefix?: "create" | "edit";
    showSshSettings?: boolean;
    layout?: "default" | "wizard";
    hideAlias?: boolean;
    embedInParentGrid?: boolean;
    isNativeSsh?: boolean;
};

export function PrivateResourceSshFields({
    control,
    setValue,
    watch,
    orgId,
    disabled = false,
    selectedSites,
    onSelectedSitesChange,
    labelPrefix = "edit",
    showSshSettings = true,
    layout = "default",
    hideAlias = false,
    embedInParentGrid = false,
    isNativeSsh: isNativeSshProp
}: PrivateResourceSshFieldsProps) {
    const t = useTranslations();
    const destinationLabelKey =
        labelPrefix === "create"
            ? "createInternalResourceDialogDestination"
            : "editInternalResourceDialogDestination";
    const destinationPortLabelKey =
        labelPrefix === "create"
            ? "createInternalResourceDialogModePort"
            : "editInternalResourceDialogModePort";

    const authDaemonMode = watch("authDaemonMode") ?? "site";
    const pamMode = inferSshPamMode(authDaemonMode, watch("pamMode"));
    const standardDaemonLocation =
        watch("standardDaemonLocation") ??
        (authDaemonMode === "remote" ? "remote" : "site");
    const formAuthDaemonPort = watch("authDaemonPort");
    const [authDaemonPortInput, setAuthDaemonPortInput] = useState(() =>
        formAuthDaemonPort != null ? String(formAuthDaemonPort) : "22123"
    );
    const isEditLayout = layout === "default";

    const [sshServerMode, setSshServerMode] = useState<"standard" | "native">(
        () => (authDaemonMode === "native" ? "native" : "standard")
    );

    const isNative =
        isNativeSshProp ??
        (isEditLayout
            ? authDaemonMode === "native"
            : sshServerMode === "native");
    const useMultiSiteTargetForm = getSshUseMultiSiteTargetForm(
        isNative,
        authDaemonMode,
        pamMode
    );

    function trimSitesToFirst() {
        if (selectedSites.length <= 1) return;

        const first = selectedSites.slice(0, 1);
        onSelectedSitesChange(first);
        setValue(
            "siteIds",
            first.map((s: Selectedsite) => s.siteId),
            { shouldValidate: true }
        );
    }

    function handlePamModeChange(value: "passthrough" | "push") {
        if (disabled) return;

        setValue("pamMode", value, { shouldValidate: true });

        if (value === "passthrough") {
            setValue("authDaemonPort", null, { shouldValidate: true });
            setAuthDaemonPortInput("22123");
            return;
        }

        if (standardDaemonLocation !== "remote" && selectedSites.length > 1) {
            trimSitesToFirst();
        }
    }

    function handleDaemonLocationChange(value: "site" | "remote") {
        if (disabled) return;

        setValue("standardDaemonLocation", value, { shouldValidate: true });
        setValue("authDaemonMode", value, { shouldValidate: true });

        if (value === "site") {
            setValue("authDaemonPort", null, { shouldValidate: true });
            setAuthDaemonPortInput("22123");
            trimSitesToFirst();
        }
    }

    function handleAuthDaemonPortChange(value: string) {
        if (disabled) return;

        setAuthDaemonPortInput(value);
        const trimmed = value.trim();
        setValue("authDaemonPort", trimmed ? Number(trimmed) : null, {
            shouldValidate: true
        });
    }

    function handleServerModeChange(mode: "standard" | "native") {
        if (disabled) return;

        setSshServerMode(mode);
        if (mode === "native") {
            setValue("authDaemonMode", "native", { shouldValidate: true });
            setValue("authDaemonPort", null, { shouldValidate: true });
            setValue("destination", null, { shouldValidate: true });
            setValue("destinationPort", null, { shouldValidate: true });
            setAuthDaemonPortInput("22123");
            trimSitesToFirst();
            return;
        }

        setValue("authDaemonMode", standardDaemonLocation, {
            shouldValidate: true
        });
        setValue("destinationPort", 22, { shouldValidate: true });
    }

    const aliasField = hideAlias ? null : (
        <PrivateResourceAliasField
            control={control}
            watch={watch}
            labelPrefix={labelPrefix}
            disabled={disabled}
        />
    );

    const standardSshTargetRow =
        orgId && !isNative ? (
            <div className="grid grid-cols-3 gap-4 items-start">
                <PrivateResourceSitesField
                    control={control}
                    orgId={orgId}
                    selectedSites={selectedSites}
                    onSelectedSitesChange={onSelectedSitesChange}
                    singleSite={!useMultiSiteTargetForm}
                />
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
                                    disabled={disabled}
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
                <FormField
                    control={control}
                    name="destinationPort"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>{t(destinationPortLabelKey)}</FormLabel>
                            <FormControl>
                                <Input
                                    className="w-full"
                                    type="number"
                                    min={1}
                                    max={65535}
                                    value={field.value ?? ""}
                                    disabled={disabled}
                                    onChange={(e) => {
                                        const raw = e.target.value;
                                        if (raw === "") {
                                            field.onChange(null);
                                            return;
                                        }
                                        const n = Number(raw);
                                        field.onChange(
                                            Number.isFinite(n) ? n : null
                                        );
                                    }}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </div>
        ) : null;

    const sshSettingsFields = showSshSettings ? (
        <SshServerSettingsFields
            idPrefix={
                layout === "wizard"
                    ? "private-ssh-create"
                    : "private-ssh-fields"
            }
            pamMode={pamMode}
            standardDaemonLocation={standardDaemonLocation}
            authDaemonPort={authDaemonPortInput}
            onPamModeChange={handlePamModeChange}
            onStandardDaemonLocationChange={handleDaemonLocationChange}
            onAuthDaemonPortChange={handleAuthDaemonPortChange}
            sshServerMode={sshServerMode}
            serverModeDisplay={layout === "wizard" ? "select" : "badge"}
            onServerModeChange={handleServerModeChange}
        />
    ) : null;

    const destinationSection = (
        <>
            <SettingsFormCell span="full">
                <SettingsSubsectionHeader>
                    <SettingsSubsectionTitle>
                        {t("sshServerDestination")}
                    </SettingsSubsectionTitle>
                    <SettingsSubsectionDescription>
                        {t("sshServerDestinationDescription")}
                    </SettingsSubsectionDescription>
                </SettingsSubsectionHeader>
            </SettingsFormCell>

            {isNative && orgId ? (
                <>
                    <SettingsFormCell span="half">
                        <PrivateResourceSitesField
                            control={control}
                            orgId={orgId}
                            selectedSites={selectedSites}
                            onSelectedSitesChange={onSelectedSitesChange}
                            singleSite
                        />
                    </SettingsFormCell>
                    <SettingsFormCell span="half">
                        <PrivateResourceAliasField
                            control={control}
                            watch={watch}
                            labelPrefix={labelPrefix}
                            disabled={disabled}
                        />
                    </SettingsFormCell>
                </>
            ) : null}

            {!isNative && orgId ? (
                <SettingsFormCell span="full">
                    {standardSshTargetRow}
                </SettingsFormCell>
            ) : null}

            {!isNative && !hideAlias ? (
                <SettingsFormCell span="half">{aliasField}</SettingsFormCell>
            ) : null}
        </>
    );

    const content: ReactNode = (
        <>
            {sshSettingsFields}
            {destinationSection}
        </>
    );

    if (embedInParentGrid) {
        return content;
    }

    return <SettingsFormGrid>{content}</SettingsFormGrid>;
}
