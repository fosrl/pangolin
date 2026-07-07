"use client";
import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import { Button } from "@app/components/ui/button";
import { useOrgContext } from "@app/hooks/useOrgContext";
import { toast } from "@app/hooks/useToast";
import { useState, useRef, useActionState, type ComponentRef } from "react";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@/components/ui/form";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";

import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { formatAxiosError } from "@app/lib/api";
import { useRouter } from "next/navigation";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionHeader,
    SettingsSectionTitle,
    SettingsSectionDescription,
    SettingsSectionBody,
    SettingsSectionForm
} from "@app/components/Settings";
import { useTranslations } from "next-intl";
import { build } from "@server/build";
import { SwitchInput } from "@app/components/SwitchInput";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import type { OrgContextType } from "@app/contexts/orgContext";
import { tierMatrix } from "@server/lib/billing/tierMatrix";

// Session length options in hours
const SESSION_LENGTH_OPTIONS = [
    { value: null, labelKey: "unenforced" },
    { value: 1, labelKey: "1Hour" },
    { value: 3, labelKey: "3Hours" },
    { value: 6, labelKey: "6Hours" },
    { value: 12, labelKey: "12Hours" },
    { value: 24, labelKey: "1DaySession" },
    { value: 72, labelKey: "3Days" },
    { value: 168, labelKey: "7Days" },
    { value: 336, labelKey: "14Days" },
    { value: 720, labelKey: "30DaysSession" },
    { value: 2160, labelKey: "90DaysSession" },
    { value: 4320, labelKey: "180DaysSession" }
];

// Password expiry options in days - will be translated in component
const PASSWORD_EXPIRY_OPTIONS = [
    { value: null, labelKey: "neverExpire" },
    { value: 1, labelKey: "1Day" },
    { value: 30, labelKey: "30Days" },
    { value: 60, labelKey: "60Days" },
    { value: 90, labelKey: "90Days" },
    { value: 180, labelKey: "180Days" },
    { value: 365, labelKey: "1Year" }
];

// Schema for security organization settings
const SecurityFormSchema = z.object({
    requireTwoFactor: z.boolean().optional(),
    maxSessionLengthHours: z.number().nullable().optional(),
    passwordExpiryDays: z.number().nullable().optional(),
    settingsLogRetentionDaysRequest: z.number(),
    settingsLogRetentionDaysAccess: z.number(),
    settingsLogRetentionDaysAction: z.number(),
    settingsLogRetentionDaysConnection: z.number()
});

const LOG_RETENTION_OPTIONS = [
    { label: "logRetentionDisabled", value: 0 },
    { label: "logRetention3Days", value: 3 },
    { label: "logRetention7Days", value: 7 },
    { label: "logRetention14Days", value: 14 },
    { label: "logRetention30Days", value: 30 },
    { label: "logRetention90Days", value: 90 },
    ...(build != "saas"
        ? [
              { label: "logRetentionForever", value: -1 },
              { label: "logRetentionEndOfFollowingYear", value: 9001 }
          ]
        : [])
];

type SectionFormProps = {
    org: OrgContextType["org"]["org"];
};

export default function SecurityPage() {
    const { org } = useOrgContext();
    const { env } = useEnvContext();
    return (
        <SettingsContainer>
            <LogRetentionSectionForm org={org.org} />
            {!env.flags.disableEnterpriseFeatures && (
                <SecuritySettingsSectionForm org={org.org} />
            )}
        </SettingsContainer>
    );
}

function LogRetentionSectionForm({ org }: SectionFormProps) {
    const form = useForm({
        resolver: zodResolver(
            SecurityFormSchema.pick({
                settingsLogRetentionDaysRequest: true,
                settingsLogRetentionDaysAccess: true,
                settingsLogRetentionDaysAction: true,
                settingsLogRetentionDaysConnection: true
            })
        ),
        defaultValues: {
            settingsLogRetentionDaysRequest:
                org.settingsLogRetentionDaysRequest ?? 15,
            settingsLogRetentionDaysAccess:
                org.settingsLogRetentionDaysAccess ?? 15,
            settingsLogRetentionDaysAction:
                org.settingsLogRetentionDaysAction ?? 15,
            settingsLogRetentionDaysConnection:
                org.settingsLogRetentionDaysConnection ?? 15
        },
        mode: "onChange"
    });

    const router = useRouter();
    const t = useTranslations();
    const { isPaidUser, subscriptionTier } = usePaidStatus();

    const [, formAction, loadingSave] = useActionState(performSave, null);
    const { env } = useEnvContext();
    const api = createApiClient({ env });

    async function performSave() {
        const isValid = await form.trigger();
        if (!isValid) return;

        const data = form.getValues();

        try {
            const reqData = {
                settingsLogRetentionDaysRequest:
                    data.settingsLogRetentionDaysRequest,
                settingsLogRetentionDaysAccess:
                    data.settingsLogRetentionDaysAccess,
                settingsLogRetentionDaysAction:
                    data.settingsLogRetentionDaysAction,
                settingsLogRetentionDaysConnection:
                    data.settingsLogRetentionDaysConnection
            } as any;

            // Update organization
            await api.post(`/org/${org.orgId}`, reqData);

            toast({
                title: t("orgUpdated"),
                description: t("orgUpdatedDescription")
            });
            router.refresh();
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("orgErrorUpdate"),
                description: formatAxiosError(e, t("orgErrorUpdateMessage"))
            });
        }
    }

    return (
        <SettingsSection>
            <SettingsSectionHeader>
                <SettingsSectionTitle>{t("logRetention")}</SettingsSectionTitle>
                <SettingsSectionDescription>
                    {t("logRetentionDescription")}
                </SettingsSectionDescription>
            </SettingsSectionHeader>
            <SettingsSectionBody>
                <SettingsSectionForm>
                    <Form {...form}>
                        <form
                            action={formAction}
                            className="grid gap-4"
                            id="org-log-retention-settings-form"
                        >
                            <FormField
                                control={form.control}
                                name="settingsLogRetentionDaysRequest"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>
                                            {t("logRetentionRequestLabel")}
                                        </FormLabel>
                                        <FormControl>
                                            <Select
                                                value={field.value.toString()}
                                                onValueChange={(value) =>
                                                    field.onChange(
                                                        parseInt(value, 10)
                                                    )
                                                }
                                            >
                                                <SelectTrigger>
                                                    <SelectValue
                                                        placeholder={t(
                                                            "selectLogRetention"
                                                        )}
                                                    />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {LOG_RETENTION_OPTIONS.filter(
                                                        (option) => {
                                                            if (
                                                                build != "saas"
                                                            ) {
                                                                return true;
                                                            }

                                                            let maxDays: number;

                                                            if (
                                                                !subscriptionTier
                                                            ) {
                                                                // No tier
                                                                maxDays = 3;
                                                            } else if (
                                                                subscriptionTier ==
                                                                "enterprise"
                                                            ) {
                                                                // Enterprise - no limit
                                                                return true;
                                                            } else if (
                                                                subscriptionTier ==
                                                                "tier3"
                                                            ) {
                                                                maxDays = 90;
                                                            } else if (
                                                                subscriptionTier ==
                                                                "tier2"
                                                            ) {
                                                                maxDays = 30;
                                                            } else if (
                                                                subscriptionTier ==
                                                                "tier1"
                                                            ) {
                                                                maxDays = 7;
                                                            } else {
                                                                // Default to most restrictive
                                                                maxDays = 3;
                                                            }

                                                            // Filter out options that exceed the max
                                                            // Special values: -1 (forever) and 9001 (end of year) should be filtered
                                                            if (
                                                                option.value <
                                                                    0 ||
                                                                option.value >
                                                                    maxDays
                                                            ) {
                                                                return false;
                                                            }

                                                            return true;
                                                        }
                                                    ).map((option) => (
                                                        <SelectItem
                                                            key={option.value}
                                                            value={option.value.toString()}
                                                        >
                                                            {t(option.label)}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {!env.flags.disableEnterpriseFeatures && (
                                <>
                                    <PaidFeaturesAlert
                                        tiers={tierMatrix.accessLogs}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="settingsLogRetentionDaysAccess"
                                        render={({ field }) => {
                                            const isDisabled = !isPaidUser(
                                                tierMatrix.accessLogs
                                            );

                                            return (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t(
                                                            "logRetentionAccessLabel"
                                                        )}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Select
                                                            value={field.value.toString()}
                                                            onValueChange={(
                                                                value
                                                            ) => {
                                                                if (
                                                                    !isDisabled
                                                                ) {
                                                                    field.onChange(
                                                                        parseInt(
                                                                            value,
                                                                            10
                                                                        )
                                                                    );
                                                                }
                                                            }}
                                                            disabled={
                                                                isDisabled
                                                            }
                                                        >
                                                            <SelectTrigger>
                                                                <SelectValue
                                                                    placeholder={t(
                                                                        "selectLogRetention"
                                                                    )}
                                                                />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {LOG_RETENTION_OPTIONS.filter(
                                                                    (
                                                                        option
                                                                    ) => {
                                                                        if (
                                                                            build !=
                                                                            "saas"
                                                                        ) {
                                                                            return true;
                                                                        }

                                                                        let maxDays: number;

                                                                        if (
                                                                            !subscriptionTier
                                                                        ) {
                                                                            // No tier
                                                                            maxDays = 3;
                                                                        } else if (
                                                                            subscriptionTier ==
                                                                            "enterprise"
                                                                        ) {
                                                                            // Enterprise - no limit
                                                                            return true;
                                                                        } else if (
                                                                            subscriptionTier ==
                                                                            "tier3"
                                                                        ) {
                                                                            maxDays = 90;
                                                                        } else if (
                                                                            subscriptionTier ==
                                                                            "tier2"
                                                                        ) {
                                                                            maxDays = 30;
                                                                        } else if (
                                                                            subscriptionTier ==
                                                                            "tier1"
                                                                        ) {
                                                                            maxDays = 7;
                                                                        } else {
                                                                            // Default to most restrictive
                                                                            maxDays = 3;
                                                                        }

                                                                        // Filter out options that exceed the max
                                                                        // Special values: -1 (forever) and 9001 (end of year) should be filtered
                                                                        if (
                                                                            option.value <
                                                                                0 ||
                                                                            option.value >
                                                                                maxDays
                                                                        ) {
                                                                            return false;
                                                                        }

                                                                        return true;
                                                                    }
                                                                ).map(
                                                                    (
                                                                        option
                                                                    ) => (
                                                                        <SelectItem
                                                                            key={
                                                                                option.value
                                                                            }
                                                                            value={option.value.toString()}
                                                                        >
                                                                            {t(
                                                                                option.label
                                                                            )}
                                                                        </SelectItem>
                                                                    )
                                                                )}
                                                            </SelectContent>
                                                        </Select>
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            );
                                        }}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="settingsLogRetentionDaysAction"
                                        render={({ field }) => {
                                            const isDisabled = !isPaidUser(
                                                tierMatrix.actionLogs
                                            );

                                            return (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t(
                                                            "logRetentionActionLabel"
                                                        )}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Select
                                                            value={field.value.toString()}
                                                            onValueChange={(
                                                                value
                                                            ) => {
                                                                if (
                                                                    !isDisabled
                                                                ) {
                                                                    field.onChange(
                                                                        parseInt(
                                                                            value,
                                                                            10
                                                                        )
                                                                    );
                                                                }
                                                            }}
                                                            disabled={
                                                                isDisabled
                                                            }
                                                        >
                                                            <SelectTrigger>
                                                                <SelectValue
                                                                    placeholder={t(
                                                                        "selectLogRetention"
                                                                    )}
                                                                />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {LOG_RETENTION_OPTIONS.filter(
                                                                    (
                                                                        option
                                                                    ) => {
                                                                        if (
                                                                            build !=
                                                                            "saas"
                                                                        ) {
                                                                            return true;
                                                                        }

                                                                        let maxDays: number;

                                                                        if (
                                                                            !subscriptionTier
                                                                        ) {
                                                                            // No tier
                                                                            maxDays = 3;
                                                                        } else if (
                                                                            subscriptionTier ==
                                                                            "enterprise"
                                                                        ) {
                                                                            // Enterprise - no limit
                                                                            return true;
                                                                        } else if (
                                                                            subscriptionTier ==
                                                                            "tier3"
                                                                        ) {
                                                                            maxDays = 90;
                                                                        } else if (
                                                                            subscriptionTier ==
                                                                            "tier2"
                                                                        ) {
                                                                            maxDays = 30;
                                                                        } else if (
                                                                            subscriptionTier ==
                                                                            "tier1"
                                                                        ) {
                                                                            maxDays = 7;
                                                                        } else {
                                                                            // Default to most restrictive
                                                                            maxDays = 3;
                                                                        }

                                                                        // Filter out options that exceed the max
                                                                        // Special values: -1 (forever) and 9001 (end of year) should be filtered
                                                                        if (
                                                                            option.value <
                                                                                0 ||
                                                                            option.value >
                                                                                maxDays
                                                                        ) {
                                                                            return false;
                                                                        }

                                                                        return true;
                                                                    }
                                                                ).map(
                                                                    (
                                                                        option
                                                                    ) => (
                                                                        <SelectItem
                                                                            key={
                                                                                option.value
                                                                            }
                                                                            value={option.value.toString()}
                                                                        >
                                                                            {t(
                                                                                option.label
                                                                            )}
                                                                        </SelectItem>
                                                                    )
                                                                )}
                                                            </SelectContent>
                                                        </Select>
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            );
                                        }}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="settingsLogRetentionDaysConnection"
                                        render={({ field }) => {
                                            const isDisabled = !isPaidUser(
                                                tierMatrix.connectionLogs
                                            );

                                            return (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t(
                                                            "logRetentionConnectionLabel"
                                                        )}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Select
                                                            value={field.value.toString()}
                                                            onValueChange={(
                                                                value
                                                            ) => {
                                                                if (
                                                                    !isDisabled
                                                                ) {
                                                                    field.onChange(
                                                                        parseInt(
                                                                            value,
                                                                            10
                                                                        )
                                                                    );
                                                                }
                                                            }}
                                                            disabled={
                                                                isDisabled
                                                            }
                                                        >
                                                            <SelectTrigger>
                                                                <SelectValue
                                                                    placeholder={t(
                                                                        "selectLogRetention"
                                                                    )}
                                                                />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {LOG_RETENTION_OPTIONS.filter(
                                                                    (
                                                                        option
                                                                    ) => {
                                                                        if (
                                                                            build !=
                                                                            "saas"
                                                                        ) {
                                                                            return true;
                                                                        }

                                                                        let maxDays: number;

                                                                        if (
                                                                            !subscriptionTier
                                                                        ) {
                                                                            // No tier
                                                                            maxDays = 3;
                                                                        } else if (
                                                                            subscriptionTier ==
                                                                            "enterprise"
                                                                        ) {
                                                                            // Enterprise - no limit
                                                                            return true;
                                                                        } else if (
                                                                            subscriptionTier ==
                                                                            "tier3"
                                                                        ) {
                                                                            maxDays = 90;
                                                                        } else if (
                                                                            subscriptionTier ==
                                                                            "tier2"
                                                                        ) {
                                                                            maxDays = 30;
                                                                        } else if (
                                                                            subscriptionTier ==
                                                                            "tier1"
                                                                        ) {
                                                                            maxDays = 7;
                                                                        } else {
                                                                            // Default to most restrictive
                                                                            maxDays = 3;
                                                                        }

                                                                        // Filter out options that exceed the max
                                                                        // Special values: -1 (forever) and 9001 (end of year) should be filtered
                                                                        if (
                                                                            option.value <
                                                                                0 ||
                                                                            option.value >
                                                                                maxDays
                                                                        ) {
                                                                            return false;
                                                                        }

                                                                        return true;
                                                                    }
                                                                ).map(
                                                                    (
                                                                        option
                                                                    ) => (
                                                                        <SelectItem
                                                                            key={
                                                                                option.value
                                                                            }
                                                                            value={option.value.toString()}
                                                                        >
                                                                            {t(
                                                                                option.label
                                                                            )}
                                                                        </SelectItem>
                                                                    )
                                                                )}
                                                            </SelectContent>
                                                        </Select>
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            );
                                        }}
                                    />
                                </>
                            )}
                        </form>
                    </Form>
                </SettingsSectionForm>
            </SettingsSectionBody>

            <div className="flex justify-end gap-2 mt-4">
                <Button
                    type="submit"
                    form="org-log-retention-settings-form"
                    loading={loadingSave}
                    disabled={loadingSave}
                >
                    {t("saveSettings")}
                </Button>
            </div>
        </SettingsSection>
    );
}

function SecuritySettingsSectionForm({ org }: SectionFormProps) {
    const router = useRouter();
    const form = useForm({
        resolver: zodResolver(
            SecurityFormSchema.pick({
                requireTwoFactor: true,
                maxSessionLengthHours: true,
                passwordExpiryDays: true
            })
        ),
        defaultValues: {
            requireTwoFactor: org.requireTwoFactor || false,
            maxSessionLengthHours: org.maxSessionLengthHours || null,
            passwordExpiryDays: org.passwordExpiryDays || null
        },
        mode: "onChange"
    });
    const t = useTranslations();
    const { isPaidUser } = usePaidStatus();

    // Track initial security policy values
    const initialSecurityValues = {
        requireTwoFactor: org.requireTwoFactor || false,
        maxSessionLengthHours: org.maxSessionLengthHours || null,
        passwordExpiryDays: org.passwordExpiryDays || null
    };

    const [isSecurityPolicyConfirmOpen, setIsSecurityPolicyConfirmOpen] =
        useState(false);

    // Check if security policies have changed
    const hasSecurityPolicyChanged = () => {
        const currentValues = form.getValues();
        return (
            currentValues.requireTwoFactor !==
                initialSecurityValues.requireTwoFactor ||
            currentValues.maxSessionLengthHours !==
                initialSecurityValues.maxSessionLengthHours ||
            currentValues.passwordExpiryDays !==
                initialSecurityValues.passwordExpiryDays
        );
    };

    const [, formAction, loadingSave] = useActionState(onSubmit, null);
    const api = createApiClient(useEnvContext());

    const formRef = useRef<ComponentRef<"form">>(null);

    async function onSubmit() {
        // Check if security policies have changed
        if (hasSecurityPolicyChanged()) {
            setIsSecurityPolicyConfirmOpen(true);
            return;
        }

        await performSave();
    }

    async function performSave() {
        const isValid = await form.trigger();
        if (!isValid) return;

        const data = form.getValues();

        try {
            const reqData = {
                requireTwoFactor: data.requireTwoFactor || false,
                maxSessionLengthHours: data.maxSessionLengthHours,
                passwordExpiryDays: data.passwordExpiryDays
            } as any;

            // Update organization
            await api.post(`/org/${org.orgId}`, reqData);

            toast({
                title: t("orgUpdated"),
                description: t("orgUpdatedDescription")
            });
            router.refresh();
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("orgErrorUpdate"),
                description: formatAxiosError(e, t("orgErrorUpdateMessage"))
            });
        }
    }

    return (
        <>
            <ConfirmDeleteDialog
                open={isSecurityPolicyConfirmOpen}
                setOpen={setIsSecurityPolicyConfirmOpen}
                dialog={
                    <div className="space-y-2">
                        <p>{t("securityPolicyChangeDescription")}</p>
                    </div>
                }
                buttonText={t("saveSettings")}
                onConfirm={performSave}
                string={t("securityPolicyChangeConfirmMessage")}
                title={t("securityPolicyChangeWarning")}
                warningText={t("securityPolicyChangeWarningText")}
            />
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("securitySettings")}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("securitySettingsDescription")}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>
                <SettingsSectionBody>
                    <SettingsSectionForm>
                        <Form {...form}>
                            <form
                                action={formAction}
                                ref={formRef}
                                id="security-settings-section-form"
                                className="space-y-4"
                            >
                                <PaidFeaturesAlert
                                    tiers={tierMatrix.twoFactorEnforcement}
                                />

                                <FormField
                                    control={form.control}
                                    name="requireTwoFactor"
                                    render={({ field }) => {
                                        const isDisabled = !isPaidUser(
                                            tierMatrix.twoFactorEnforcement
                                        );

                                        return (
                                            <FormItem className="col-span-2">
                                                <div className="flex items-center gap-2">
                                                    <FormControl>
                                                        <SwitchInput
                                                            id="require-two-factor"
                                                            defaultChecked={
                                                                field.value ||
                                                                false
                                                            }
                                                            label={t(
                                                                "requireTwoFactorForAllUsers"
                                                            )}
                                                            disabled={
                                                                isDisabled
                                                            }
                                                            onCheckedChange={(
                                                                val
                                                            ) => {
                                                                if (
                                                                    !isDisabled
                                                                ) {
                                                                    form.setValue(
                                                                        "requireTwoFactor",
                                                                        val
                                                                    );
                                                                }
                                                            }}
                                                        />
                                                    </FormControl>
                                                </div>
                                                <FormMessage />
                                                <FormDescription>
                                                    {t(
                                                        "requireTwoFactorDescription"
                                                    )}
                                                </FormDescription>
                                            </FormItem>
                                        );
                                    }}
                                />
                                <FormField
                                    control={form.control}
                                    name="maxSessionLengthHours"
                                    render={({ field }) => {
                                        const isDisabled = !isPaidUser(
                                            tierMatrix.sessionDurationPolicies
                                        );

                                        return (
                                            <FormItem className="col-span-2">
                                                <FormLabel>
                                                    {t("maxSessionLength")}
                                                </FormLabel>
                                                <FormControl>
                                                    <Select
                                                        value={
                                                            field.value?.toString() ||
                                                            "null"
                                                        }
                                                        onValueChange={(
                                                            value
                                                        ) => {
                                                            if (!isDisabled) {
                                                                const numValue =
                                                                    value ===
                                                                    "null"
                                                                        ? null
                                                                        : parseInt(
                                                                              value,
                                                                              10
                                                                          );
                                                                form.setValue(
                                                                    "maxSessionLengthHours",
                                                                    numValue
                                                                );
                                                            }
                                                        }}
                                                        disabled={isDisabled}
                                                    >
                                                        <SelectTrigger>
                                                            <SelectValue
                                                                placeholder={t(
                                                                    "selectSessionLength"
                                                                )}
                                                            />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {SESSION_LENGTH_OPTIONS.map(
                                                                (option) => (
                                                                    <SelectItem
                                                                        key={
                                                                            option.value ===
                                                                            null
                                                                                ? "null"
                                                                                : option.value.toString()
                                                                        }
                                                                        value={
                                                                            option.value ===
                                                                            null
                                                                                ? "null"
                                                                                : option.value.toString()
                                                                        }
                                                                    >
                                                                        {t(
                                                                            option.labelKey
                                                                        )}
                                                                    </SelectItem>
                                                                )
                                                            )}
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl>
                                                <FormMessage />
                                                <FormDescription>
                                                    {t(
                                                        "maxSessionLengthDescription"
                                                    )}
                                                </FormDescription>
                                            </FormItem>
                                        );
                                    }}
                                />
                                <FormField
                                    control={form.control}
                                    name="passwordExpiryDays"
                                    render={({ field }) => {
                                        const isDisabled = !isPaidUser(
                                            tierMatrix.passwordExpirationPolicies
                                        );

                                        return (
                                            <FormItem className="col-span-2">
                                                <FormLabel>
                                                    {t("passwordExpiryDays")}
                                                </FormLabel>
                                                <FormControl>
                                                    <Select
                                                        value={
                                                            field.value?.toString() ||
                                                            "null"
                                                        }
                                                        onValueChange={(
                                                            value
                                                        ) => {
                                                            if (!isDisabled) {
                                                                const numValue =
                                                                    value ===
                                                                    "null"
                                                                        ? null
                                                                        : parseInt(
                                                                              value,
                                                                              10
                                                                          );
                                                                form.setValue(
                                                                    "passwordExpiryDays",
                                                                    numValue
                                                                );
                                                            }
                                                        }}
                                                        disabled={isDisabled}
                                                    >
                                                        <SelectTrigger>
                                                            <SelectValue
                                                                placeholder={t(
                                                                    "selectPasswordExpiry"
                                                                )}
                                                            />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {PASSWORD_EXPIRY_OPTIONS.map(
                                                                (option) => (
                                                                    <SelectItem
                                                                        key={
                                                                            option.value ===
                                                                            null
                                                                                ? "null"
                                                                                : option.value.toString()
                                                                        }
                                                                        value={
                                                                            option.value ===
                                                                            null
                                                                                ? "null"
                                                                                : option.value.toString()
                                                                        }
                                                                    >
                                                                        {t(
                                                                            option.labelKey
                                                                        )}
                                                                    </SelectItem>
                                                                )
                                                            )}
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl>
                                                <FormDescription>
                                                    <FormMessage />
                                                    {t(
                                                        "editPasswordExpiryDescription"
                                                    )}
                                                </FormDescription>
                                            </FormItem>
                                        );
                                    }}
                                />
                            </form>
                        </Form>
                    </SettingsSectionForm>
                </SettingsSectionBody>

                <div className="flex justify-end gap-2 mt-4">
                    <Button
                        type="submit"
                        form="security-settings-section-form"
                        loading={loadingSave}
                        disabled={
                            loadingSave ||
                            !isPaidUser(tierMatrix.twoFactorEnforcement) ||
                            !isPaidUser(tierMatrix.sessionDurationPolicies) ||
                            !isPaidUser(tierMatrix.passwordExpirationPolicies)
                        }
                    >
                        {t("saveSettings")}
                    </Button>
                </div>
            </SettingsSection>
        </>
    );
}
