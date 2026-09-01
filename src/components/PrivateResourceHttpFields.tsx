"use client";

import DomainPicker from "@app/components/DomainPicker";
import {
    SettingsFormCell,
    SettingsFormGrid,
    SettingsSubsectionDescription,
    SettingsSubsectionHeader,
    SettingsSubsectionTitle
} from "@app/components/Settings";
import { SwitchInput } from "@app/components/SwitchInput";
import {
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { Input } from "@app/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@app/components/ui/select";
import { useTranslations } from "next-intl";
import type { Control, UseFormSetValue, UseFormWatch } from "react-hook-form";

type PrivateResourceHttpFieldsProps = {
    control: Control<any>;
    setValue: UseFormSetValue<any>;
    orgId: string;
    watch: UseFormWatch<any>;
    disabled?: boolean;
    siteResourceId?: number;
    labelPrefix?: "create" | "edit";
    hideDomainPicker?: boolean;
    hidePaidFeaturesAlert?: boolean;
};

export function PrivateResourceHttpFields({
    control,
    setValue,
    orgId,
    watch,
    disabled = false,
    siteResourceId,
    labelPrefix = "edit",
    hideDomainPicker = false
}: PrivateResourceHttpFieldsProps) {
    const t = useTranslations();
    const schemeLabelKey =
        labelPrefix === "create"
            ? "createInternalResourceDialogScheme"
            : "editInternalResourceDialogScheme";
    const destinationLabelKey =
        labelPrefix === "create"
            ? "createInternalResourceDialogDestination"
            : "editInternalResourceDialogDestination";
    const destinationPortLabelKey =
        labelPrefix === "create"
            ? "createInternalResourceDialogModePort"
            : "editInternalResourceDialogModePort";
    const httpConfigurationTitleKey =
        labelPrefix === "create"
            ? "createInternalResourceDialogHttpConfiguration"
            : "editInternalResourceDialogHttpConfiguration";
    const httpConfigurationDescriptionKey =
        labelPrefix === "create"
            ? "createInternalResourceDialogHttpConfigurationDescription"
            : "editInternalResourceDialogHttpConfigurationDescription";
    const enableSslLabelKey =
        labelPrefix === "create"
            ? "createInternalResourceDialogEnableSsl"
            : "editInternalResourceDialogEnableSsl";
    const enableSslDescriptionKey =
        labelPrefix === "create"
            ? "createInternalResourceDialogEnableSslDescription"
            : "editInternalResourceDialogEnableSslDescription";

    const httpConfigSubdomain = watch("httpConfigSubdomain");
    const httpConfigDomainId = watch("httpConfigDomainId");
    const httpConfigFullDomain = watch("httpConfigFullDomain");

    return (
        <SettingsFormGrid>
            <SettingsFormCell span="quarter">
                <FormField
                    control={control}
                    name="scheme"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>{t(schemeLabelKey)}</FormLabel>
                            <Select
                                onValueChange={field.onChange}
                                value={field.value ?? "http"}
                                disabled={disabled}
                            >
                                <FormControl>
                                    <SelectTrigger className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    <SelectItem value="http">http</SelectItem>
                                    <SelectItem value="https">https</SelectItem>
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </SettingsFormCell>
            <SettingsFormCell span="half">
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
            </SettingsFormCell>
            <SettingsFormCell span="quarter">
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
            </SettingsFormCell>

            {!hideDomainPicker && (
                <>
                    <SettingsFormCell span="full">
                        <SettingsSubsectionHeader>
                            <SettingsSubsectionTitle>
                                {t(httpConfigurationTitleKey)}
                            </SettingsSubsectionTitle>
                            <SettingsSubsectionDescription>
                                {t(httpConfigurationDescriptionKey)}
                            </SettingsSubsectionDescription>
                        </SettingsSubsectionHeader>
                    </SettingsFormCell>
                    <SettingsFormCell span="full">
                        <div
                            className={
                                disabled
                                    ? "pointer-events-none opacity-50"
                                    : undefined
                            }
                        >
                            <DomainPicker
                                key={
                                    siteResourceId
                                        ? `http-domain-${siteResourceId}`
                                        : "http-domain-create"
                                }
                                orgId={orgId}
                                cols={2}
                                hideFreeDomain
                                defaultSubdomain={
                                    httpConfigSubdomain ?? undefined
                                }
                                defaultDomainId={
                                    httpConfigDomainId ?? undefined
                                }
                                defaultFullDomain={
                                    httpConfigFullDomain ?? undefined
                                }
                                onDomainChange={(res) => {
                                    if (res === null) {
                                        setValue("httpConfigSubdomain", null);
                                        setValue("httpConfigDomainId", null);
                                        setValue("httpConfigFullDomain", null);
                                        return;
                                    }
                                    setValue(
                                        "httpConfigSubdomain",
                                        res.subdomain ?? null
                                    );
                                    setValue(
                                        "httpConfigDomainId",
                                        res.domainId
                                    );
                                    setValue(
                                        "httpConfigFullDomain",
                                        res.fullDomain
                                    );
                                }}
                            />
                        </div>
                    </SettingsFormCell>
                    <SettingsFormCell span="half">
                        <FormField
                            control={control}
                            name="ssl"
                            render={({ field }) => (
                                <FormItem>
                                    <FormControl>
                                        <SwitchInput
                                            id="private-resource-ssl"
                                            label={t(enableSslLabelKey)}
                                            description={t(
                                                enableSslDescriptionKey
                                            )}
                                            checked={!!field.value}
                                            onCheckedChange={field.onChange}
                                            disabled={disabled}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    </SettingsFormCell>
                </>
            )}

            {hideDomainPicker && (
                <SettingsFormCell span="half">
                    <FormField
                        control={control}
                        name="ssl"
                        render={({ field }) => (
                            <FormItem>
                                <FormControl>
                                    <SwitchInput
                                        id="private-resource-ssl"
                                        label={t(enableSslLabelKey)}
                                        description={t(enableSslDescriptionKey)}
                                        checked={!!field.value}
                                        onCheckedChange={field.onChange}
                                        disabled={disabled}
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                </SettingsFormCell>
            )}
        </SettingsFormGrid>
    );
}
