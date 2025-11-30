"use client";
import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import AuthPageSettings, {
    AuthPageSettingsRef
} from "@app/components/private/AuthPageSettings";

import { Button } from "@app/components/ui/button";
import { useOrgContext } from "@app/hooks/useOrgContext";
import { userOrgUserContext } from "@app/hooks/useOrgUserContext";
import { toast } from "@app/hooks/useToast";
import { useState, useRef } from "react";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
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
import { AxiosResponse } from "axios";
import { DeleteOrgResponse, ListUserOrgsResponse } from "@server/routers/org";
import { useRouter } from "next/navigation";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionHeader,
    SettingsSectionTitle,
    SettingsSectionDescription,
    SettingsSectionBody,
    SettingsSectionForm,
    SettingsSectionFooter
} from "@app/components/Settings";
import { useUserContext } from "@app/hooks/useUserContext";
import { useTranslations } from "next-intl";
import { build } from "@server/build";
import { SwitchInput } from "@app/components/SwitchInput";
import { SecurityFeaturesAlert } from "@app/components/SecurityFeaturesAlert";
import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";
import { useSubscriptionStatusContext } from "@app/hooks/useSubscriptionStatusContext";

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

// Schema for general organization settings
const GeneralFormSchema = z.object({
    name: z.string(),
    subnet: z.string().optional(),
    requireTwoFactor: z.boolean().optional(),
    maxSessionLengthHours: z.number().nullable().optional(),
    passwordExpiryDays: z.number().nullable().optional(),
    settingsLogRetentionDaysRequest: z.number(),
    settingsLogRetentionDaysAccess: z.number(),
    settingsLogRetentionDaysAction: z.number()
});

type GeneralFormValues = z.infer<typeof GeneralFormSchema>;

const LOG_RETENTION_OPTIONS = [
    { label: "logRetentionDisabled", value: 0 },
    { label: "logRetention3Days", value: 3 },
    { label: "logRetention7Days", value: 7 },
    { label: "logRetention14Days", value: 14 },
    { label: "logRetention30Days", value: 30 },
    { label: "logRetention90Days", value: 90 },
    ...(build != "saas" ? [{ label: "logRetentionForever", value: -1 }] : [])
];

export default function GeneralPage() {
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const { orgUser } = userOrgUserContext();
    const router = useRouter();
    const { org } = useOrgContext();
    const api = createApiClient(useEnvContext());
    const { user } = useUserContext();
    const t = useTranslations();
    const { env } = useEnvContext();
    const { licenseStatus, isUnlocked } = useLicenseStatusContext();
    const subscription = useSubscriptionStatusContext();

    // Check if security features are disabled due to licensing/subscription
    const isSecurityFeatureDisabled = () => {
        const isEnterpriseNotLicensed = build === "enterprise" && !isUnlocked();
        const isSaasNotSubscribed =
            build === "saas" && !subscription?.isSubscribed();
        return isEnterpriseNotLicensed || isSaasNotSubscribed;
    };

    const [loadingDelete, setLoadingDelete] = useState(false);
    const [loadingSave, setLoadingSave] = useState(false);
    const [isSecurityPolicyConfirmOpen, setIsSecurityPolicyConfirmOpen] =
        useState(false);
    const authPageSettingsRef = useRef<AuthPageSettingsRef>(null);

    const form = useForm({
        resolver: zodResolver(GeneralFormSchema),
        defaultValues: {
            name: org?.org.name,
            subnet: org?.org.subnet || "", // Add default value for subnet
            requireTwoFactor: org?.org.requireTwoFactor || false,
            maxSessionLengthHours: org?.org.maxSessionLengthHours || null,
            passwordExpiryDays: org?.org.passwordExpiryDays || null,
            settingsLogRetentionDaysRequest:
                org.org.settingsLogRetentionDaysRequest ?? 15,
            settingsLogRetentionDaysAccess:
                org.org.settingsLogRetentionDaysAccess ?? 15,
            settingsLogRetentionDaysAction:
                org.org.settingsLogRetentionDaysAction ?? 15
        },
        mode: "onChange"
    });

    // Track initial security policy values
    const initialSecurityValues = {
        requireTwoFactor: org?.org.requireTwoFactor || false,
        maxSessionLengthHours: org?.org.maxSessionLengthHours || null,
        passwordExpiryDays: org?.org.passwordExpiryDays || null
    };

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

    async function deleteOrg() {
        setLoadingDelete(true);
        try {
            const res = await api.delete<AxiosResponse<DeleteOrgResponse>>(
                `/org/${org?.org.orgId}`
            );
            toast({
                title: t("orgDeleted"),
                description: t("orgDeletedMessage")
            });
            if (res.status === 200) {
                pickNewOrgAndNavigate();
            }
        } catch (err) {
            console.error(err);
            toast({
                variant: "destructive",
                title: t("orgErrorDelete"),
                description: formatAxiosError(err, t("orgErrorDeleteMessage"))
            });
        } finally {
            setLoadingDelete(false);
        }
    }

    async function pickNewOrgAndNavigate() {
        try {
            const res = await api.get<AxiosResponse<ListUserOrgsResponse>>(
                `/user/${user.userId}/orgs`
            );

            if (res.status === 200) {
                if (res.data.data.orgs.length > 0) {
                    const orgId = res.data.data.orgs[0].orgId;
                    // go to `/${orgId}/settings`);
                    router.push(`/${orgId}/settings`);
                } else {
                    // go to `/setup`
                    router.push("/setup");
                }
            }
        } catch (err) {
            console.error(err);
            toast({
                variant: "destructive",
                title: t("orgErrorFetch"),
                description: formatAxiosError(err, t("orgErrorFetchMessage"))
            });
        }
    }

    async function onSubmit(data: GeneralFormValues) {
        // Check if security policies have changed
        if (hasSecurityPolicyChanged()) {
            setIsSecurityPolicyConfirmOpen(true);
            return;
        }

        await performSave(data);
    }

    async function performSave(data: GeneralFormValues) {
        setLoadingSave(true);

        try {
            const reqData = {
                name: data.name,
                settingsLogRetentionDaysRequest:
                    data.settingsLogRetentionDaysRequest,
                settingsLogRetentionDaysAccess:
                    data.settingsLogRetentionDaysAccess,
                settingsLogRetentionDaysAction:
                    data.settingsLogRetentionDaysAction
            } as any;
            if (build !== "oss") {
                reqData.requireTwoFactor = data.requireTwoFactor || false;
                reqData.maxSessionLengthHours = data.maxSessionLengthHours;
                reqData.passwordExpiryDays = data.passwordExpiryDays;
            }

            // Update organization
            await api.post(`/org/${org?.org.orgId}`, reqData);

            // Also save auth page settings if they have unsaved changes
            if (
                build === "saas" &&
                authPageSettingsRef.current?.hasUnsavedChanges()
            ) {
                await authPageSettingsRef.current.saveAuthSettings();
            }

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
        } finally {
            setLoadingSave(false);
        }
    }

    return (
        <SettingsContainer>
            <ConfirmDeleteDialog
                open={isDeleteModalOpen}
                setOpen={(val) => {
                    setIsDeleteModalOpen(val);
                }}
                dialog={
                    <div>
                        <p>{t("orgQuestionRemove")}</p>
                        <p>{t("orgMessageRemove")}</p>
                    </div>
                }
                buttonText={t("orgDeleteConfirm")}
                onConfirm={deleteOrg}
                string={org?.org.name || ""}
                title={t("orgDelete")}
            />
            <ConfirmDeleteDialog
                open={isSecurityPolicyConfirmOpen}
                setOpen={setIsSecurityPolicyConfirmOpen}
                dialog={
                    <div>
                        <p>{t("securityPolicyChangeDescription")}</p>
                    </div>
                }
                buttonText={t("saveSettings")}
                onConfirm={() => performSave(form.getValues())}
                string={t("securityPolicyChangeConfirmMessage")}
                title={t("securityPolicyChangeWarning")}
                warningText={t("securityPolicyChangeWarningText")}
            />

            <Form {...form}>
                <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="space-y-4"
                    id="org-settings-form"
                >
                    <SettingsSection>
                        <SettingsSectionHeader>
                            <SettingsSectionTitle>
                                {t("general")}
                            </SettingsSectionTitle>
                            <SettingsSectionDescription>
                                {t("orgGeneralSettingsDescription")}
                            </SettingsSectionDescription>
                        </SettingsSectionHeader>
                        <SettingsSectionBody>
                            <SettingsSectionForm>
                                <FormField
                                    control={form.control}
                                    name="name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t("name")}</FormLabel>
                                            <FormControl>
                                                <Input {...field} />
                                            </FormControl>
                                            <FormMessage />
                                            <FormDescription>
                                                {t("orgDisplayName")}
                                            </FormDescription>
                                        </FormItem>
                                    )}
                                />
                                {env.flags.enableClients && (
                                    <FormField
                                        control={form.control}
                                        name="subnet"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t("subnet")}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input
                                                        {...field}
                                                        disabled={true}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                                <FormDescription>
                                                    {t("subnetDescription")}
                                                </FormDescription>
                                            </FormItem>
                                        )}
                                    />
                                )}
                            </SettingsSectionForm>
                        </SettingsSectionBody>
                    </SettingsSection>

                    <SettingsSection>
                        <SettingsSectionHeader>
                            <SettingsSectionTitle>
                                {t("logRetention")}
                            </SettingsSectionTitle>
                            <SettingsSectionDescription>
                                {t("logRetentionDescription")}
                            </SettingsSectionDescription>
                        </SettingsSectionHeader>
                        <SettingsSectionBody>
                            <SettingsSectionForm>
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
                                                                    build ==
                                                                        "saas" &&
                                                                    !subscription?.subscribed &&
                                                                    option.value >
                                                                        30
                                                                ) {
                                                                    return false;
                                                                }
                                                                return true;
                                                            }
                                                        ).map((option) => (
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
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {build != "oss" && (
                                    <>
                                        <SecurityFeaturesAlert />

                                        <FormField
                                            control={form.control}
                                            name="settingsLogRetentionDaysAccess"
                                            render={({ field }) => {
                                                const isDisabled =
                                                    (build == "saas" &&
                                                        !subscription?.subscribed) ||
                                                    (build == "enterprise" &&
                                                        !isUnlocked());

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
                                                                    {LOG_RETENTION_OPTIONS.map(
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
                                                const isDisabled =
                                                    (build == "saas" &&
                                                        !subscription?.subscribed) ||
                                                    (build == "enterprise" &&
                                                        !isUnlocked());

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
                                                                    {LOG_RETENTION_OPTIONS.map(
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
                            </SettingsSectionForm>
                        </SettingsSectionBody>
                    </SettingsSection>

                    {build !== "oss" && (
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
                                <SecurityFeaturesAlert />
                                    <FormField
                                        control={form.control}
                                        name="requireTwoFactor"
                                        render={({ field }) => {
                                            const isDisabled =
                                                isSecurityFeatureDisabled();

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
                                            const isDisabled =
                                                isSecurityFeatureDisabled();

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
                                                                if (
                                                                    !isDisabled
                                                                ) {
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
                                                            disabled={
                                                                isDisabled
                                                            }
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
                                                                    (
                                                                        option
                                                                    ) => (
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
                                            const isDisabled =
                                                isSecurityFeatureDisabled();

                                            return (
                                                <FormItem className="col-span-2">
                                                    <FormLabel>
                                                        {t(
                                                            "passwordExpiryDays"
                                                        )}
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
                                                                if (
                                                                    !isDisabled
                                                                ) {
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
                                                            disabled={
                                                                isDisabled
                                                            }
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
                                                                    (
                                                                        option
                                                                    ) => (
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
                                </SettingsSectionForm>
                            </SettingsSectionBody>
                        </SettingsSection>
                    )}
                </form>
            </Form>

            {build === "saas" && <AuthPageSettings ref={authPageSettingsRef} />}

            <div className="flex justify-end gap-2">
                {build !== "saas" && (
                    <Button
                        variant="destructive"
                        onClick={() => setIsDeleteModalOpen(true)}
                        className="flex items-center gap-2"
                        loading={loadingDelete}
                        disabled={loadingDelete}
                    >
                        {t("orgDelete")}
                    </Button>
                )}
                <Button
                    type="submit"
                    form="org-settings-form"
                    loading={loadingSave}
                    disabled={loadingSave}
                >
                    {t("saveSettings")}
                </Button>
            </div>
        </SettingsContainer>
    );
}
