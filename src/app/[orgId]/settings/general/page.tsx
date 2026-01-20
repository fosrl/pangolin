"use client";
import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import AuthPageSettings, {
    AuthPageSettingsRef
} from "@app/components/private/AuthPageSettings";

import { Button } from "@app/components/ui/button";
import { useOrgContext } from "@app/hooks/useOrgContext";
import { userOrgUserContext } from "@app/hooks/useOrgUserContext";
import { toast } from "@app/hooks/useToast";
import {
    useState,
    useRef,
    useTransition,
    useActionState,
    type ComponentRef
} from "react";
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
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";
import { useSubscriptionStatusContext } from "@app/hooks/useSubscriptionStatusContext";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import type { OrgContextType } from "@app/contexts/orgContext";

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
    ...(build != "saas"
        ? [
              { label: "logRetentionForever", value: -1 },
              { label: "logRetentionEndOfFollowingYear", value: 9001 }
          ]
        : [])
];

export default function GeneralPage() {
    const { org } = useOrgContext();
    return (
        <SettingsContainer>
            <GeneralSectionForm org={org.org} />

            <LogRetentionSectionForm org={org.org} />

            {build !== "oss" && <SecuritySettingsSectionForm org={org.org} />}
            {build !== "saas" && <DeleteForm org={org.org} />}
        </SettingsContainer>
    );
}

type SectionFormProps = {
    org: OrgContextType["org"]["org"];
};

function DeleteForm({ org }: SectionFormProps) {
    const t = useTranslations();
    const api = createApiClient(useEnvContext());

    const router = useRouter();
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [loadingDelete, startTransition] = useTransition();
    const { user } = useUserContext();

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
    async function deleteOrg() {
        try {
            const res = await api.delete<AxiosResponse<DeleteOrgResponse>>(
                `/org/${org.orgId}`
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
        }
    }
    return (
        <>
            <ConfirmDeleteDialog
                open={isDeleteModalOpen}
                setOpen={(val) => {
                    setIsDeleteModalOpen(val);
                }}
                dialog={
                    <div className="space-y-2">
                        <p>{t("orgQuestionRemove")}</p>
                        <p>{t("orgMessageRemove")}</p>
                    </div>
                }
                buttonText={t("orgDeleteConfirm")}
                onConfirm={async () => startTransition(deleteOrg)}
                string={org.name || ""}
                title={t("orgDelete")}
            />
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("dangerSection")}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("dangerSectionDescription")}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>
                <SettingsSectionFooter>
                    <Button
                        variant="destructive"
                        onClick={() => setIsDeleteModalOpen(true)}
                        className="flex items-center gap-2"
                        loading={loadingDelete}
                        disabled={loadingDelete}
                    >
                        {t("orgDelete")}
                    </Button>
                </SettingsSectionFooter>
            </SettingsSection>
        </>
    );
}

function GeneralSectionForm({ org }: SectionFormProps) {
    const { updateOrg } = useOrgContext();
    const form = useForm({
        resolver: zodResolver(
            GeneralFormSchema.pick({
                name: true,
                subnet: true
            })
        ),
        defaultValues: {
            name: org.name,
            subnet: org.subnet || "" // Add default value for subnet
        },
        mode: "onChange"
    });
    const t = useTranslations();
    const router = useRouter();

    const [, formAction, loadingSave] = useActionState(performSave, null);
    const api = createApiClient(useEnvContext());

    async function performSave() {
        const isValid = await form.trigger();
        if (!isValid) return;

        const data = form.getValues();

        try {
            const reqData = {
                name: data.name
            } as any;

            // Update organization
            await api.post(`/org/${org.orgId}`, reqData);

            // Update the org context to reflect the change in the info card
            updateOrg({
                name: data.name
            });

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
                <SettingsSectionTitle>{t("general")}</SettingsSectionTitle>
                <SettingsSectionDescription>
                    {t("orgGeneralSettingsDescription")}
                </SettingsSectionDescription>
            </SettingsSectionHeader>
            <SettingsSectionBody>
                <SettingsSectionForm>
                    <Form {...form}>
                        <form
                            action={formAction}
                            className="grid gap-4"
                            id="org-general-settings-form"
                        >
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
                        </form>
                    </Form>
                </SettingsSectionForm>
            </SettingsSectionBody>

            <div className="flex justify-end gap-2 mt-4">
                <Button
                    type="submit"
                    form="org-general-settings-form"
                    loading={loadingSave}
                    disabled={loadingSave}
                >
                    {t("saveSettings")}
                </Button>
            </div>
        </SettingsSection>
    );
}

function LogRetentionSectionForm({ org }: SectionFormProps) {
    const form = useForm({
        resolver: zodResolver(
            GeneralFormSchema.pick({
                settingsLogRetentionDaysRequest: true,
                settingsLogRetentionDaysAccess: true,
                settingsLogRetentionDaysAction: true
            })
        ),
        defaultValues: {
            settingsLogRetentionDaysRequest:
                org.settingsLogRetentionDaysRequest ?? 15,
            settingsLogRetentionDaysAccess:
                org.settingsLogRetentionDaysAccess ?? 15,
            settingsLogRetentionDaysAction:
                org.settingsLogRetentionDaysAction ?? 15
        },
        mode: "onChange"
    });

    const router = useRouter();
    const t = useTranslations();
    const { isPaidUser, hasSaasSubscription } = usePaidStatus();

    const [, formAction, loadingSave] = useActionState(performSave, null);
    const api = createApiClient(useEnvContext());

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
                    data.settingsLogRetentionDaysAction
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
                                                                hasSaasSubscription &&
                                                                option.value >
                                                                    30
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

                            {build !== "oss" && (
                                <>
                                    <PaidFeaturesAlert />

                                    <FormField
                                        control={form.control}
                                        name="settingsLogRetentionDaysAccess"
                                        render={({ field }) => {
                                            const isDisabled = !isPaidUser;

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
                                            const isDisabled = !isPaidUser;

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
            GeneralFormSchema.pick({
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
                                <PaidFeaturesAlert />
                                <FormField
                                    control={form.control}
                                    name="requireTwoFactor"
                                    render={({ field }) => {
                                        const isDisabled = !isPaidUser;

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
                                        const isDisabled = !isPaidUser;

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
                                        const isDisabled = !isPaidUser;

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
                        disabled={loadingSave}
                    >
                        {t("saveSettings")}
                    </Button>
                </div>
            </SettingsSection>
        </>
    );
}
