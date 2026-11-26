"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@app/components/ui/button";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { Input } from "@app/components/ui/input";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "@app/hooks/useToast";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionHeader,
    SettingsSectionTitle,
    SettingsSectionDescription,
    SettingsSectionBody,
    SettingsSectionForm,
    SettingsSectionGrid
} from "@app/components/Settings";
import { formatAxiosError } from "@app/lib/api";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useState, useEffect } from "react";
import ApiIntegrationConfigWidget from "@app/components/ApiIntegrationConfigWidget";
import IdpSessionRevalidationDescription from "@app/components/IdpSessionRevalidationDescription";
import {
    buildGoogleIDPAPIConfig,
    googleDirectorySyncFormFields,
    refineGoogleDirectorySyncFields
} from "@app/components/GoogleIDPAPIConfigFields";
import IdpProvisioningMethodFields from "@app/components/IdpProvisioningMethodFields";
import {
    InfoSection,
    InfoSectionContent,
    InfoSections,
    InfoSectionTitle
} from "@app/components/InfoSection";
import CopyToClipboard from "@app/components/CopyToClipboard";
import IdpTypeBadge from "@app/components/IdpTypeBadge";
import IdpIdentifierChangeDialog from "@app/components/IdpIdentifierChangeDialog";
import IdpSyncNowDialog from "@app/components/IdpSyncNowDialog";
import { RefreshCwIcon } from "lucide-react";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { scopesForSessionRevalidation } from "@app/lib/idp/ensureOfflineAccessScope";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { useTranslations } from "next-intl";
import {
    GLOBAL_IDP_SYNC_DRAFT_KEYS,
    IDP_API_DRAFT_KEYS,
    pickIdpDraft,
    supportsApiIntegration
} from "@app/lib/idpApiConfig";
import { SwitchInput } from "@app/components/SwitchInput";

export default function GeneralPage() {
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const router = useRouter();
    const { idpId } = useParams();
    const [loading, setLoading] = useState(false);
    const [initialLoading, setInitialLoading] = useState(true);
    const [variant, setVariant] = useState<"oidc" | "google" | "azure">("oidc");
    const [originalIdentifierPath, setOriginalIdentifierPath] = useState("");
    const [identifierConfirmOpen, setIdentifierConfirmOpen] = useState(false);
    // saved values: the preview and "Sync now" run what's in the DB, not the unsaved form
    const [savedSyncEnabled, setSavedSyncEnabled] = useState(false);
    const [syncDialogOpen, setSyncDialogOpen] = useState(false);
    // the preview runs on the form's values; applying runs the saved ones, so it
    // needs the preview to match what's saved (`savedSyncDraftJson`)
    const [syncDraft, setSyncDraft] = useState<Record<string, unknown>>();
    const [syncApplyBlockedReason, setSyncApplyBlockedReason] = useState<
        "syncNotSaved" | "unsavedChanges" | null
    >(null);
    const [savedSyncDraftJson, setSavedSyncDraftJson] = useState<string | null>(
        null
    );
    // bumped on load and on save, to snapshot the saved values once the form has them
    const [savedVersion, setSavedVersion] = useState(0);
    const [configuredServiceAccountEmail, setConfiguredServiceAccountEmail] =
        useState<string | undefined>();
    const [pendingPayload, setPendingPayload] = useState<Record<
        string,
        unknown
    > | null>(null);

    const redirectUrl = `${env.app.dashboardUrl}/auth/idp/${idpId}/oidc/callback`;
    const t = useTranslations();
    const { isPaidUser } = usePaidStatus();

    const OidcFormSchema = z.object({
        name: z.string().min(2, { message: t("nameMin", { len: 2 }) }),
        clientId: z.string().min(1, { message: t("idpClientIdRequired") }),
        clientSecret: z
            .string()
            .min(1, { message: t("idpClientSecretRequired") }),
        authUrl: z.url({ message: t("idpErrorAuthUrlInvalid") }),
        tokenUrl: z.url({ message: t("idpErrorTokenUrlInvalid") }),
        identifierPath: z.string().min(1, { message: t("idpPathRequired") }),
        emailPath: z.string().optional(),
        namePath: z.string().optional(),
        scopes: z.string().min(1, { message: t("idpScopeRequired") }),
        allowManualProvisioning: z.boolean().default(true),
        autoProvision: z.boolean().default(false),
        sessionRevalidation: z.boolean().default(false),
        apiIntegrationEnabled: z.boolean().default(false),
        directorySyncEnabled: z.boolean().default(false),
        directorySyncDeletions: z.boolean().default(true)
    });

    const GoogleFormSchema = z
        .object({
            name: z.string().min(2, { message: t("nameMin", { len: 2 }) }),
            clientId: z.string().min(1, { message: t("idpClientIdRequired") }),
            clientSecret: z
                .string()
                .min(1, { message: t("idpClientSecretRequired") }),
            allowManualProvisioning: z.boolean().default(true),
            autoProvision: z.boolean().default(false),
            sessionRevalidation: z.boolean().default(false),
            apiIntegrationEnabled: z.boolean().default(false),
            directorySyncEnabled: z.boolean().default(false),
            directorySyncDeletions: z.boolean().default(true),
            ...googleDirectorySyncFormFields
        })
        .superRefine((data, ctx) =>
            refineGoogleDirectorySyncFields(data, ctx, {
                // the stored key is kept when the field is left empty
                keyRequired: !configuredServiceAccountEmail,
                t
            })
        );

    const AzureFormSchema = z.object({
        name: z.string().min(2, { message: t("nameMin", { len: 2 }) }),
        clientId: z.string().min(1, { message: t("idpClientIdRequired") }),
        clientSecret: z
            .string()
            .min(1, { message: t("idpClientSecretRequired") }),
        tenantId: z.string().min(1, { message: t("idpTenantIdRequired") }),
        allowManualProvisioning: z.boolean().default(true),
        autoProvision: z.boolean().default(false),
        sessionRevalidation: z.boolean().default(false),
        apiIntegrationEnabled: z.boolean().default(false),
        directorySyncEnabled: z.boolean().default(false),
        directorySyncDeletions: z.boolean().default(true)
    });

    type OidcFormValues = z.infer<typeof OidcFormSchema>;
    type GoogleFormValues = z.infer<typeof GoogleFormSchema>;
    type AzureFormValues = z.infer<typeof AzureFormSchema>;
    type GeneralFormValues =
        OidcFormValues | GoogleFormValues | AzureFormValues;

    const getFormSchema = () => {
        switch (variant) {
            case "google":
                return GoogleFormSchema;
            case "azure":
                return AzureFormSchema;
            default:
                return OidcFormSchema;
        }
    };

    const form = useForm<GeneralFormValues>({
        resolver: zodResolver(getFormSchema()) as never,
        defaultValues: {
            name: "",
            clientId: "",
            clientSecret: "",
            authUrl: "",
            tokenUrl: "",
            identifierPath: "sub",
            emailPath: "email",
            namePath: "name",
            scopes: "openid profile email",
            allowManualProvisioning: true,
            autoProvision: true,
            sessionRevalidation: false,
            apiIntegrationEnabled: false,
            directorySyncEnabled: false,
            directorySyncDeletions: true,
            tenantId: "",
            googleServiceAccountKey: "",
            googleAdminEmail: "",
            googleCustomerId: ""
        }
    });

    const formSyncEnabled = useWatch({
        control: form.control,
        name: "directorySyncEnabled"
    });
    const formApiIntegrationEnabled = useWatch({
        control: form.control,
        name: "apiIntegrationEnabled"
    });
    // the server refuses the sync too, so don't offer it without the plan.
    // Follows the form: the preview runs on the unsaved values
    const canPreviewSync =
        formApiIntegrationEnabled &&
        formSyncEnabled &&
        isPaidUser(tierMatrix.idpAPIIntegration);

    useEffect(() => {
        form.clearErrors();
    }, [variant, form]);

    useEffect(() => {
        const loadIdp = async () => {
            try {
                const res = await api.get(`/idp/${idpId}`);
                if (res.status === 200) {
                    const data = res.data.data;
                    const idpVariant =
                        (data.idpOidcConfig?.variant as
                            "oidc" | "google" | "azure") || "oidc";
                    setVariant(idpVariant);
                    setSavedSyncEnabled(
                        data.idp.apiIntegrationEnabled &&
                            data.idp.directorySyncEnabled
                    );
                    setOriginalIdentifierPath(
                        data.idpOidcConfig?.identifierPath ?? "sub"
                    );

                    let tenantId = "";
                    if (idpVariant === "azure" && data.idpOidcConfig?.authUrl) {
                        const tenantMatch = data.idpOidcConfig.authUrl.match(
                            /login\.microsoftonline\.com\/([^/]+)\/oauth2/
                        );
                        if (tenantMatch) {
                            tenantId = tenantMatch[1];
                        }
                    }

                    const formData: Record<string, unknown> = {
                        name: data.idp.name,
                        clientId: data.idpOidcConfig.clientId,
                        clientSecret: data.idpOidcConfig.clientSecret,
                        allowManualProvisioning:
                            data.idp.allowManualProvisioning,
                        autoProvision: data.idp.autoProvision,
                        apiIntegrationEnabled: data.idp.apiIntegrationEnabled,
                        directorySyncEnabled: data.idp.directorySyncEnabled,
                        directorySyncDeletions: data.idp.directorySyncDeletions,
                        sessionRevalidation:
                            data.idp.sessionRevalidation ?? false
                    };

                    if (idpVariant === "oidc") {
                        formData.authUrl = data.idpOidcConfig.authUrl;
                        formData.tokenUrl = data.idpOidcConfig.tokenUrl;
                        formData.identifierPath =
                            data.idpOidcConfig.identifierPath;
                        formData.emailPath =
                            data.idpOidcConfig.emailPath ?? undefined;
                        formData.namePath =
                            data.idpOidcConfig.namePath ?? undefined;
                        formData.scopes = data.idpOidcConfig.scopes;
                    } else if (idpVariant === "azure") {
                        formData.tenantId = tenantId;
                    } else if (idpVariant === "google") {
                        const apiConfig = data.idp.apiConfig;
                        formData.googleServiceAccountKey = "";
                        formData.googleAdminEmail = apiConfig?.adminEmail ?? "";
                        formData.googleCustomerId = apiConfig?.customerId ?? "";
                        setConfiguredServiceAccountEmail(
                            apiConfig?.serviceAccountEmail
                        );
                    }

                    form.reset(formData as GeneralFormValues);
                }
            } catch (e) {
                toast({
                    title: t("error"),
                    description: formatAxiosError(e),
                    variant: "destructive"
                });
                router.push("/admin/idp");
            } finally {
                setInitialLoading(false);
                setSavedVersion((v) => v + 1);
            }
        };

        loadIdp();
    }, [idpId]);

    /** Validates against the variant's schema, showing the errors on the form. */
    function validateForm(data: GeneralFormValues): boolean {
        const schema = getFormSchema();
        const validationResult = schema.safeParse(data);
        if (validationResult.success) {
            return true;
        }

        const errors = validationResult.error.flatten().fieldErrors;
        Object.keys(errors).forEach((key) => {
            const fieldName = key as keyof GeneralFormValues;
            const errorMessage =
                (errors as Record<string, string[] | undefined>)[key]?.[0] ||
                t("invalidValue");
            form.setError(fieldName, {
                type: "manual",
                message: errorMessage
            });
        });
        return false;
    }

    /** The update payload for the form values. Also the source of the preview/test drafts. */
    function buildPayload(data: GeneralFormValues): Record<string, unknown> {
        let payload: Record<string, unknown> = {
            name: data.name,
            clientId: data.clientId,
            clientSecret: data.clientSecret,
            allowManualProvisioning: data.allowManualProvisioning,
            autoProvision: data.autoProvision,
            apiIntegrationEnabled:
                supportsApiIntegration(variant) && data.apiIntegrationEnabled,
            directorySyncEnabled:
                supportsApiIntegration(variant) &&
                data.apiIntegrationEnabled &&
                data.directorySyncEnabled,
            directorySyncDeletions: data.directorySyncDeletions,
            sessionRevalidation: data.sessionRevalidation,
            variant
        };

        if (variant === "oidc") {
            const oidcData = data as OidcFormValues;
            let scopes = oidcData.scopes;
            if (data.sessionRevalidation) {
                scopes = scopesForSessionRevalidation(scopes, "oidc");
            }
            payload = {
                ...payload,
                authUrl: oidcData.authUrl,
                tokenUrl: oidcData.tokenUrl,
                identifierPath: oidcData.identifierPath,
                emailPath: oidcData.emailPath ?? "",
                namePath: oidcData.namePath ?? "",
                scopes
            };
        } else if (variant === "azure") {
            const azureData = data as AzureFormValues;
            const authUrl = `https://login.microsoftonline.com/${azureData.tenantId}/oauth2/v2.0/authorize`;
            const tokenUrl = `https://login.microsoftonline.com/${azureData.tenantId}/oauth2/v2.0/token`;
            let scopes = "openid profile email";
            if (data.sessionRevalidation) {
                scopes = scopesForSessionRevalidation(scopes, "azure");
            }
            payload = {
                ...payload,
                authUrl,
                tokenUrl,
                identifierPath: "email",
                emailPath: "email",
                namePath: "name",
                scopes
            };
        } else if (variant === "google") {
            // Google refresh tokens use access_type=offline, not offline_access
            payload = {
                ...payload,
                authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
                tokenUrl: "https://oauth2.googleapis.com/token",
                identifierPath: "email",
                emailPath: "email",
                namePath: "name",
                scopes: "openid profile email",
                apiConfig: buildGoogleIDPAPIConfig(data as GoogleFormValues)
            };
        }

        return payload;
    }

    /** The form's unsaved values to preview or test, `null` (errors shown) when invalid. */
    function currentDraft(
        keys: readonly string[]
    ): Record<string, unknown> | null {
        const data = form.getValues();
        if (!validateForm(data)) {
            return null;
        }
        return pickIdpDraft(buildPayload(data), keys);
    }

    // snapshot of the saved values, once the form holds them (after load / save)
    useEffect(() => {
        if (savedVersion === 0) {
            return;
        }
        setSavedSyncDraftJson(
            JSON.stringify(
                pickIdpDraft(
                    buildPayload(form.getValues()),
                    GLOBAL_IDP_SYNC_DRAFT_KEYS
                )
            )
        );
    }, [savedVersion]);

    function openSyncPreview() {
        const draft = currentDraft(GLOBAL_IDP_SYNC_DRAFT_KEYS);
        if (!draft) {
            return;
        }
        setSyncDraft(draft);
        setSyncApplyBlockedReason(
            !savedSyncEnabled
                ? "syncNotSaved"
                : JSON.stringify(draft) !== savedSyncDraftJson
                  ? "unsavedChanges"
                  : null
        );
        setSyncDialogOpen(true);
    }

    async function onSubmit(data: GeneralFormValues) {
        setLoading(true);

        try {
            if (!validateForm(data)) {
                return;
            }

            const payload = buildPayload(data);

            const nextIdentifierPath =
                variant === "oidc"
                    ? (data as OidcFormValues).identifierPath
                    : undefined;

            if (
                typeof nextIdentifierPath === "string" &&
                nextIdentifierPath !== originalIdentifierPath
            ) {
                setPendingPayload(payload);
                setIdentifierConfirmOpen(true);
                return;
            }

            await persistIdp(payload);
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        } finally {
            setLoading(false);
        }
    }

    async function persistIdp(payload: Record<string, unknown>) {
        const res = await api.post(`/idp/${idpId}/oidc`, payload);

        if (res.status === 200) {
            if (typeof payload.identifierPath === "string") {
                setOriginalIdentifierPath(payload.identifierPath);
            }
            setSavedSyncEnabled(Boolean(payload.directorySyncEnabled));
            setSavedVersion((v) => v + 1);
            const apiConfig = payload.apiConfig as
                ReturnType<typeof buildGoogleIDPAPIConfig> | undefined;
            if (apiConfig?.serviceAccountKey) {
                setConfiguredServiceAccountEmail(
                    apiConfig.serviceAccountKey.client_email
                );
                form.setValue("googleServiceAccountKey", "");
            } else if (apiConfig?.serviceAccountKey === null) {
                // removed: the server cleared the whole stored config
                setConfiguredServiceAccountEmail(undefined);
                form.setValue("googleAdminEmail", "");
                form.setValue("googleCustomerId", "");
            }
            form.setValue("googleRemoveServiceAccountKey", false);
            toast({
                title: t("success"),
                description: t("idpUpdatedDescription")
            });
            router.refresh();
        }
    }

    async function confirmIdentifierChange() {
        if (!pendingPayload) {
            return;
        }

        setLoading(true);
        try {
            await persistIdp(pendingPayload);
            setPendingPayload(null);
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        } finally {
            setLoading(false);
        }
    }

    if (initialLoading) {
        return null;
    }

    return (
        <>
            <IdpIdentifierChangeDialog
                open={identifierConfirmOpen}
                setOpen={(open) => {
                    setIdentifierConfirmOpen(open);
                    if (!open) {
                        setPendingPayload(null);
                    }
                }}
                onConfirm={confirmIdentifierChange}
            />
            <IdpSyncNowDialog
                open={syncDialogOpen}
                setOpen={setSyncDialogOpen}
                draft={syncDraft}
                applyBlockedReason={syncApplyBlockedReason}
                idpId={idpId as string}
            />
            <SettingsContainer>
                <SettingsSection>
                    <SettingsSectionHeader>
                        <SettingsSectionTitle>
                            {t("idpTitle")}
                        </SettingsSectionTitle>
                        <SettingsSectionDescription>
                            {t("idpSettingsDescription")}
                        </SettingsSectionDescription>
                    </SettingsSectionHeader>
                    <SettingsSectionBody>
                        <InfoSections cols={3}>
                            <InfoSection>
                                <InfoSectionTitle>
                                    {t("redirectUrl")}
                                </InfoSectionTitle>
                                <InfoSectionContent>
                                    <CopyToClipboard text={redirectUrl} />
                                </InfoSectionContent>
                            </InfoSection>
                        </InfoSections>

                        <div className="flex items-center space-x-2 mb-4">
                            <span className="text-sm font-medium text-muted-foreground">
                                {t("idpTypeLabel")}:
                            </span>
                            <IdpTypeBadge type={variant} />
                        </div>

                        <SettingsSectionForm>
                            <Form {...form}>
                                <form
                                    onSubmit={form.handleSubmit(onSubmit)}
                                    className="space-y-4"
                                    id="general-settings-form"
                                >
                                    <FormField
                                        control={form.control}
                                        name="name"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t("name")}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input {...field} />
                                                </FormControl>
                                                <FormDescription>
                                                    {t("idpDisplayName")}
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    {!env.flags.disableEnterpriseFeatures && (
                                        <div className="space-y-2">
                                            <PaidFeaturesAlert
                                                tiers={
                                                    tierMatrix.sessionRevalidation
                                                }
                                            />
                                            <SwitchInput
                                                id="session-revalidation-toggle"
                                                label={t(
                                                    "idpSessionRevalidation"
                                                )}
                                                checked={form.watch(
                                                    "sessionRevalidation"
                                                )}
                                                onCheckedChange={(checked) => {
                                                    form.setValue(
                                                        "sessionRevalidation",
                                                        checked
                                                    );
                                                    if (
                                                        checked &&
                                                        variant === "oidc"
                                                    ) {
                                                        const current =
                                                            form.getValues(
                                                                "scopes"
                                                            ) ||
                                                            "openid profile email";
                                                        form.setValue(
                                                            "scopes",
                                                            scopesForSessionRevalidation(
                                                                current,
                                                                "oidc"
                                                            )
                                                        );
                                                    }
                                                }}
                                                disabled={
                                                    !isPaidUser(
                                                        tierMatrix.sessionRevalidation
                                                    )
                                                }
                                            />
                                            <FormDescription>
                                                <IdpSessionRevalidationDescription />
                                            </FormDescription>
                                        </div>
                                    )}
                                </form>
                            </Form>
                        </SettingsSectionForm>
                    </SettingsSectionBody>
                </SettingsSection>

                {supportsApiIntegration(variant) && (
                    <SettingsSection>
                        <SettingsSectionHeader>
                            <SettingsSectionTitle>
                                {t("idpApiIntegration")}
                            </SettingsSectionTitle>
                            <SettingsSectionDescription>
                                {t("idpApiIntegrationDescription")}
                            </SettingsSectionDescription>
                        </SettingsSectionHeader>
                        <SettingsSectionBody>
                            <Form {...form}>
                                <form
                                    onSubmit={form.handleSubmit(onSubmit)}
                                    className="space-y-4"
                                    id="general-settings-form"
                                >
                                    <ApiIntegrationConfigWidget
                                        variant={variant}
                                        apiIntegrationEnabled={form.watch(
                                            "apiIntegrationEnabled"
                                        )}
                                        onApiIntegrationEnabledChange={(
                                            checked
                                        ) => {
                                            form.setValue(
                                                "apiIntegrationEnabled",
                                                checked
                                            );
                                            if (!checked) {
                                                form.setValue(
                                                    "directorySyncEnabled",
                                                    false
                                                );
                                            }
                                        }}
                                        configuredServiceAccountEmail={
                                            configuredServiceAccountEmail
                                        }
                                        testApiBase={`/idp/${idpId}`}
                                        getTestDraft={() =>
                                            currentDraft(IDP_API_DRAFT_KEYS)
                                        }
                                    />
                                </form>
                            </Form>
                        </SettingsSectionBody>
                    </SettingsSection>
                )}

                <SettingsSection>
                    <SettingsSectionHeader>
                        <SettingsSectionTitle>
                            {t("idpUserProvisioning")}
                        </SettingsSectionTitle>
                        <SettingsSectionDescription>
                            {t("idpUserProvisioningDescription")}
                        </SettingsSectionDescription>
                    </SettingsSectionHeader>
                    <SettingsSectionBody>
                        <Form {...form}>
                            <form
                                onSubmit={form.handleSubmit(onSubmit)}
                                className="space-y-4"
                                id="general-settings-form"
                            >
                                <IdpProvisioningMethodFields
                                    syncAvailable={supportsApiIntegration(
                                        variant
                                    )}
                                    jitPaywalled={false}
                                />
                                {(form.watch("autoProvision") ||
                                    form.watch("directorySyncEnabled")) && (
                                    <FormDescription>
                                        {t.rich(
                                            "idpAdminAutoProvisionPoliciesTabHint",
                                            {
                                                policiesTabLink: (chunks) => (
                                                    <Link
                                                        href={`/admin/idp/${idpId}/policies`}
                                                        className="text-primary hover:underline inline-flex items-center gap-1"
                                                    >
                                                        {chunks}
                                                    </Link>
                                                )
                                            }
                                        )}
                                    </FormDescription>
                                )}
                            </form>
                        </Form>
                        {canPreviewSync && (
                            <div className="flex flex-col gap-2 items-start border-t pt-6 mt-6">
                                <Button
                                    type="button"
                                    variant="outlinePrimary"
                                    onClick={openSyncPreview}
                                    className="gap-2"
                                >
                                    <RefreshCwIcon className="size-4 flex-none" />
                                    {t("idpSyncNow")}
                                </Button>
                                <p className="text-sm text-muted-foreground">
                                    {t("idpSyncGlobalNowDescription")}
                                </p>
                            </div>
                        )}
                    </SettingsSectionBody>
                </SettingsSection>

                {variant === "google" && (
                    <SettingsSection>
                        <SettingsSectionHeader>
                            <SettingsSectionTitle>
                                {t("idpGoogleConfiguration")}
                            </SettingsSectionTitle>
                            <SettingsSectionDescription>
                                {t("idpGoogleConfigurationDescription")}
                            </SettingsSectionDescription>
                        </SettingsSectionHeader>
                        <SettingsSectionBody>
                            <SettingsSectionForm>
                                <Form {...form}>
                                    <form
                                        onSubmit={form.handleSubmit(onSubmit)}
                                        className="space-y-4"
                                        id="general-settings-form"
                                    >
                                        <FormField
                                            control={form.control}
                                            name="clientId"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t("idpClientId")}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input {...field} />
                                                    </FormControl>
                                                    <FormDescription>
                                                        {t(
                                                            "idpGoogleClientIdDescription"
                                                        )}
                                                    </FormDescription>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        <FormField
                                            control={form.control}
                                            name="clientSecret"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t("idpClientSecret")}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            type="password"
                                                            {...field}
                                                        />
                                                    </FormControl>
                                                    <FormDescription>
                                                        {t(
                                                            "idpGoogleClientSecretDescription"
                                                        )}
                                                    </FormDescription>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </form>
                                </Form>
                            </SettingsSectionForm>
                        </SettingsSectionBody>
                    </SettingsSection>
                )}

                {variant === "azure" && (
                    <SettingsSection>
                        <SettingsSectionHeader>
                            <SettingsSectionTitle>
                                {t("idpAzureConfiguration")}
                            </SettingsSectionTitle>
                            <SettingsSectionDescription>
                                {t("idpAzureConfigurationDescription")}
                            </SettingsSectionDescription>
                        </SettingsSectionHeader>
                        <SettingsSectionBody>
                            <SettingsSectionForm>
                                <Form {...form}>
                                    <form
                                        onSubmit={form.handleSubmit(onSubmit)}
                                        className="space-y-4"
                                        id="general-settings-form"
                                    >
                                        <FormField
                                            control={form.control}
                                            name="tenantId"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t("idpTenantId")}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input {...field} />
                                                    </FormControl>
                                                    <FormDescription>
                                                        {t(
                                                            "idpAzureTenantIdDescription"
                                                        )}
                                                    </FormDescription>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        <FormField
                                            control={form.control}
                                            name="clientId"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t("idpClientId")}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input {...field} />
                                                    </FormControl>
                                                    <FormDescription>
                                                        {t(
                                                            "idpAzureClientIdDescription"
                                                        )}
                                                    </FormDescription>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        <FormField
                                            control={form.control}
                                            name="clientSecret"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t("idpClientSecret")}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            type="password"
                                                            {...field}
                                                        />
                                                    </FormControl>
                                                    <FormDescription>
                                                        {t(
                                                            "idpAzureClientSecretDescription"
                                                        )}
                                                    </FormDescription>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </form>
                                </Form>
                            </SettingsSectionForm>
                        </SettingsSectionBody>
                    </SettingsSection>
                )}

                {variant === "oidc" && (
                    <SettingsSectionGrid cols={2}>
                        <SettingsSection>
                            <SettingsSectionHeader>
                                <SettingsSectionTitle>
                                    {t("idpOidcConfigure")}
                                </SettingsSectionTitle>
                                <SettingsSectionDescription>
                                    {t("idpOidcConfigureDescription")}
                                </SettingsSectionDescription>
                            </SettingsSectionHeader>
                            <SettingsSectionBody>
                                <SettingsSectionForm>
                                    <Form {...form}>
                                        <form
                                            onSubmit={form.handleSubmit(
                                                onSubmit
                                            )}
                                            className="space-y-4"
                                            id="general-settings-form"
                                        >
                                            <FormField
                                                control={form.control}
                                                name="clientId"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t("idpClientId")}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input {...field} />
                                                        </FormControl>
                                                        <FormDescription>
                                                            {t(
                                                                "idpClientIdDescription"
                                                            )}
                                                        </FormDescription>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={form.control}
                                                name="clientSecret"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t(
                                                                "idpClientSecret"
                                                            )}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                type="password"
                                                                {...field}
                                                            />
                                                        </FormControl>
                                                        <FormDescription>
                                                            {t(
                                                                "idpClientSecretDescription"
                                                            )}
                                                        </FormDescription>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={form.control}
                                                name="authUrl"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t("idpAuthUrl")}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input {...field} />
                                                        </FormControl>
                                                        <FormDescription>
                                                            {t(
                                                                "idpAuthUrlDescription"
                                                            )}
                                                        </FormDescription>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={form.control}
                                                name="tokenUrl"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t("idpTokenUrl")}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input {...field} />
                                                        </FormControl>
                                                        <FormDescription>
                                                            {t(
                                                                "idpTokenUrlDescription"
                                                            )}
                                                        </FormDescription>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </form>
                                    </Form>
                                </SettingsSectionForm>
                            </SettingsSectionBody>
                        </SettingsSection>

                        <SettingsSection>
                            <SettingsSectionHeader>
                                <SettingsSectionTitle>
                                    {t("idpToken")}
                                </SettingsSectionTitle>
                                <SettingsSectionDescription>
                                    {t("idpTokenDescription")}
                                </SettingsSectionDescription>
                            </SettingsSectionHeader>
                            <SettingsSectionBody>
                                <SettingsSectionForm>
                                    <Form {...form}>
                                        <form
                                            onSubmit={form.handleSubmit(
                                                onSubmit
                                            )}
                                            className="space-y-4"
                                            id="general-settings-form"
                                        >
                                            <FormField
                                                control={form.control}
                                                name="identifierPath"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t(
                                                                "idpJmespathLabel"
                                                            )}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input {...field} />
                                                        </FormControl>
                                                        <FormDescription>
                                                            {t(
                                                                "idpJmespathLabelDescription"
                                                            )}
                                                        </FormDescription>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={form.control}
                                                name="emailPath"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t(
                                                                "idpJmespathEmailPathOptional"
                                                            )}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                {...field}
                                                                value={
                                                                    field.value ||
                                                                    ""
                                                                }
                                                            />
                                                        </FormControl>
                                                        <FormDescription>
                                                            {t(
                                                                "idpJmespathEmailPathOptionalDescription"
                                                            )}
                                                        </FormDescription>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={form.control}
                                                name="namePath"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t(
                                                                "idpJmespathNamePathOptional"
                                                            )}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                {...field}
                                                                value={
                                                                    field.value ||
                                                                    ""
                                                                }
                                                            />
                                                        </FormControl>
                                                        <FormDescription>
                                                            {t(
                                                                "idpJmespathNamePathOptionalDescription"
                                                            )}
                                                        </FormDescription>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={form.control}
                                                name="scopes"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t(
                                                                "idpOidcConfigureScopes"
                                                            )}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input {...field} />
                                                        </FormControl>
                                                        <FormDescription>
                                                            {t(
                                                                "idpOidcConfigureScopesDescription"
                                                            )}
                                                        </FormDescription>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </form>
                                    </Form>
                                </SettingsSectionForm>
                            </SettingsSectionBody>
                        </SettingsSection>
                    </SettingsSectionGrid>
                )}
            </SettingsContainer>

            <div className="flex justify-end mt-8">
                <Button
                    type="button"
                    form="general-settings-form"
                    loading={loading}
                    disabled={loading}
                    onClick={() => {
                        form.handleSubmit(onSubmit)();
                    }}
                >
                    {t("saveSettings")}
                </Button>
            </div>
        </>
    );
}
