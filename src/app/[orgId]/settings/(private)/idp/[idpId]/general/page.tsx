"use client";

import ApiIntegrationConfigWidget from "@app/components/ApiIntegrationConfigWidget";
import CopyToClipboard from "@app/components/CopyToClipboard";
import {
    buildGoogleIDPAPIConfig,
    googleDirectorySyncFormFields,
    refineGoogleDirectorySyncFields
} from "@app/components/GoogleIDPAPIConfigFields";
import IdpIdentifierChangeDialog from "@app/components/IdpIdentifierChangeDialog";
import IdpLastSyncedAt from "@app/components/IdpLastSyncedAt";
import IdpSyncNowDialog from "@app/components/IdpSyncNowDialog";
import IdpTypeBadge from "@app/components/IdpTypeBadge";
import {
    InfoSection,
    InfoSectionContent,
    InfoSections,
    InfoSectionTitle
} from "@app/components/InfoSection";
import IdpUserProvisioningFields from "@app/components/IdpUserProvisioningFields";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionForm,
    SettingsSectionGrid,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
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
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import {
    compileRoleMappingExpression,
    defaultRoleMappingConfig,
    defaultSyncRoleMappingConfig,
    detectRoleMappingConfig,
    ensureMappingBuilderRuleIds,
    RoleMappingConfig
} from "@app/lib/idpRoleMapping";
import { zodResolver } from "@hookform/resolvers/zod";
import { ListRolesResponse } from "@server/routers/role";
import { AxiosResponse } from "axios";
import { useTranslations } from "next-intl";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { RefreshCwIcon } from "lucide-react";
import { supportsApiIntegration } from "@app/lib/idpApiConfig";
import IdpSessionRevalidationDescription from "@app/components/IdpSessionRevalidationDescription";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { SwitchInput } from "@app/components/SwitchInput";
import { scopesForSessionRevalidation } from "@app/lib/idp/ensureOfflineAccessScope";

export default function GeneralPage() {
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const router = useRouter();
    const { idpId, orgId } = useParams();
    const [loading, setLoading] = useState(false);
    const [initialLoading, setInitialLoading] = useState(true);
    const [roles, setRoles] = useState<{ roleId: number; name: string }[]>([]);
    const [roleMapping, setRoleMapping] = useState<RoleMappingConfig>(
        defaultRoleMappingConfig
    );
    const [syncRoleMapping, setSyncRoleMapping] = useState<RoleMappingConfig>(
        defaultSyncRoleMappingConfig
    );
    const [variant, setVariant] = useState<"oidc" | "google" | "azure">("oidc");
    const [configuredServiceAccountEmail, setConfiguredServiceAccountEmail] =
        useState<string | undefined>();
    const [originalIdentifierPath, setOriginalIdentifierPath] = useState("");
    const [identifierConfirmOpen, setIdentifierConfirmOpen] = useState(false);
    // saved values: the preview and "Sync now" run what's in the DB, not the unsaved form
    const [savedApiIntegrationEnabled, setSavedApiIntegrationEnabled] =
        useState(false);
    const [savedSyncEnabled, setSavedSyncEnabled] = useState(false);
    const [syncDialogOpen, setSyncDialogOpen] = useState(false);
    const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
    const [pendingPayload, setPendingPayload] = useState<Record<
        string,
        unknown
    > | null>(null);

    const dashboardRedirectUrl = `${env.app.dashboardUrl}/auth/idp/${idpId}/oidc/callback`;
    const [redirectUrl, setRedirectUrl] = useState(
        `${env.app.dashboardUrl}/auth/idp/${idpId}/oidc/callback`
    );
    const t = useTranslations();
    const { isPaidUser } = usePaidStatus();

    // OIDC form schema (full configuration)
    const OidcFormSchema = z.object({
        name: z.string().min(2, { message: t("nameMin", { len: 2 }) }),
        clientId: z.string().min(1, { message: t("idpClientIdRequired") }),
        clientSecret: z
            .string()
            .min(1, { message: t("idpClientSecretRequired") }),
        roleMapping: z.string().nullable().optional(),
        roleId: z.number().nullable().optional(),
        authUrl: z.url({ message: t("idpErrorAuthUrlInvalid") }),
        tokenUrl: z.url({ message: t("idpErrorTokenUrlInvalid") }),
        identifierPath: z.string().min(1, { message: t("idpPathRequired") }),
        emailPath: z.string().nullable().optional(),
        namePath: z.string().nullable().optional(),
        scopes: z.string().min(1, { message: t("idpScopeRequired") }),
        apiIntegrationEnabled: z.boolean().default(false),
        allowManualProvisioning: z.boolean().default(true),
        autoProvision: z.boolean().default(false),
        directorySyncEnabled: z.boolean().default(false),
        directorySyncDeletions: z.boolean().default(true),
        sessionRevalidation: z.boolean().default(false),
        orgMapping: z.string().optional(),
        syncOrgMapping: z.string().optional(),
        mappingsLinked: z.boolean().default(true),
        createMissingRoles: z.boolean().default(false),
        syncCreateMissingRoles: z.boolean().default(false)
    });

    // Google form schema (simplified)
    const GoogleFormSchema = z
        .object({
            name: z.string().min(2, { message: t("nameMin", { len: 2 }) }),
            clientId: z.string().min(1, { message: t("idpClientIdRequired") }),
            clientSecret: z
                .string()
                .min(1, { message: t("idpClientSecretRequired") }),
            roleMapping: z.string().nullable().optional(),
            roleId: z.number().nullable().optional(),
            apiIntegrationEnabled: z.boolean().default(false),
            allowManualProvisioning: z.boolean().default(true),
            autoProvision: z.boolean().default(false),
            directorySyncEnabled: z.boolean().default(false),
            directorySyncDeletions: z.boolean().default(true),
            sessionRevalidation: z.boolean().default(false),
            orgMapping: z.string().optional(),
            syncOrgMapping: z.string().optional(),
            mappingsLinked: z.boolean().default(true),
            createMissingRoles: z.boolean().default(false),
            syncCreateMissingRoles: z.boolean().default(false),
            ...googleDirectorySyncFormFields
        })
        .superRefine((data, ctx) =>
            refineGoogleDirectorySyncFields(data, ctx, {
                // the stored key is kept when the field is left empty
                keyRequired: !configuredServiceAccountEmail,
                t
            })
        );

    // Azure form schema (simplified with tenant ID)
    const AzureFormSchema = z.object({
        name: z.string().min(2, { message: t("nameMin", { len: 2 }) }),
        clientId: z.string().min(1, { message: t("idpClientIdRequired") }),
        clientSecret: z
            .string()
            .min(1, { message: t("idpClientSecretRequired") }),
        tenantId: z.string().min(1, { message: t("idpTenantIdRequired") }),
        roleMapping: z.string().nullable().optional(),
        roleId: z.number().nullable().optional(),
        apiIntegrationEnabled: z.boolean().default(false),
        allowManualProvisioning: z.boolean().default(true),
        autoProvision: z.boolean().default(false),
        directorySyncEnabled: z.boolean().default(false),
        directorySyncDeletions: z.boolean().default(true),
        sessionRevalidation: z.boolean().default(false),
        orgMapping: z.string().optional(),
        syncOrgMapping: z.string().optional(),
        mappingsLinked: z.boolean().default(true),
        createMissingRoles: z.boolean().default(false),
        syncCreateMissingRoles: z.boolean().default(false)
    });

    type OidcFormValues = z.infer<typeof OidcFormSchema>;
    type GoogleFormValues = z.infer<typeof GoogleFormSchema>;
    type AzureFormValues = z.infer<typeof AzureFormSchema>;
    type GeneralFormValues =
        OidcFormValues | GoogleFormValues | AzureFormValues;

    // Get the appropriate schema based on variant
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
        resolver: zodResolver(getFormSchema()) as any, // is this right?
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
            apiIntegrationEnabled: false,
            allowManualProvisioning: true,
            autoProvision: true,
            directorySyncEnabled: false,
            directorySyncDeletions: true,
            sessionRevalidation: false,
            roleMapping: null,
            roleId: null,
            tenantId: "",
            orgMapping: "",
            syncOrgMapping: "",
            mappingsLinked: true,
            createMissingRoles: false,
            syncCreateMissingRoles: false,
            googleServiceAccountKey: "",
            googleAdminEmail: "",
            googleCustomerId: ""
        }
    });

    const formSyncEnabled = useWatch({
        control: form.control,
        name: "directorySyncEnabled"
    });
    // the server refuses the sync too, so don't offer it without the plan.
    // Follows the sync switch in the form, before saving, both ways: the dry run
    // only needs the saved API integration; applying needs sync saved as enabled.
    const canPreviewSync =
        savedApiIntegrationEnabled &&
        formSyncEnabled &&
        isPaidUser(tierMatrix.idpAPIIntegration);

    // Update form resolver when variant changes
    useEffect(() => {
        form.clearErrors();
        // Note: We can't change the resolver dynamically, so we'll handle validation in onSubmit
    }, [variant]);

    useEffect(() => {
        const loadIdp = async (
            availableRoles: { roleId: number; name: string }[]
        ) => {
            try {
                const res = await api.get(`/org/${orgId}/idp/${idpId}`);
                if (res.status === 200) {
                    const data = res.data.data;
                    const roleMapping = data.idpOrg.roleMapping;
                    const idpVariant = data.idpOidcConfig?.variant || "oidc";
                    setOriginalIdentifierPath(
                        data.idpOidcConfig?.identifierPath ?? "sub"
                    );
                    setRedirectUrl(res.data.data.redirectUrl);
                    setLastSyncedAt(data.idpOrg?.lastSyncedAt ?? null);
                    setSavedApiIntegrationEnabled(
                        data.idp.apiIntegrationEnabled
                    );
                    setSavedSyncEnabled(
                        data.idp.apiIntegrationEnabled &&
                            data.idp.directorySyncEnabled
                    );

                    // Set the variant
                    setVariant(idpVariant as "oidc" | "google" | "azure");

                    const detectedRoleMappingConfig =
                        detectRoleMappingConfig(roleMapping);

                    // Extract tenant ID from Azure URLs if present
                    let tenantId = "";
                    if (idpVariant === "azure" && data.idpOidcConfig?.authUrl) {
                        // Azure URL format: https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/authorize
                        const tenantMatch = data.idpOidcConfig.authUrl.match(
                            /login\.microsoftonline\.com\/([^\/]+)\/oauth2/
                        );
                        if (tenantMatch) {
                            tenantId = tenantMatch[1];
                        }
                    }

                    // Reset form with appropriate data based on variant
                    const formData: any = {
                        name: data.idp.name,
                        clientId: data.idpOidcConfig.clientId,
                        clientSecret: data.idpOidcConfig.clientSecret,
                        apiIntegrationEnabled: data.idp.apiIntegrationEnabled,
                        allowManualProvisioning:
                            data.idp.allowManualProvisioning,
                        autoProvision:
                            data.idpOrg?.autoProvision ??
                            data.idp.autoProvision,
                        directorySyncEnabled: data.idp.directorySyncEnabled,
                        directorySyncDeletions:
                            data.idpOrg?.directorySyncDeletions ?? true,
                        sessionRevalidation:
                            data.idp.sessionRevalidation ?? false,
                        roleMapping: roleMapping || null,
                        roleId: null,
                        orgMapping: data.idpOrg?.orgMapping ?? "",
                        syncOrgMapping: data.idpOrg?.syncOrgMapping ?? "",
                        mappingsLinked: data.idpOrg?.mappingsLinked ?? true,
                        createMissingRoles:
                            data.idpOrg?.createMissingRoles ?? false,
                        syncCreateMissingRoles:
                            data.idpOrg?.syncCreateMissingRoles ?? false
                    };

                    // Add variant-specific fields
                    if (idpVariant === "oidc") {
                        formData.authUrl = data.idpOidcConfig.authUrl;
                        formData.tokenUrl = data.idpOidcConfig.tokenUrl;
                        formData.identifierPath =
                            data.idpOidcConfig.identifierPath;
                        formData.emailPath =
                            data.idpOidcConfig.emailPath || null;
                        formData.namePath = data.idpOidcConfig.namePath || null;
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

                    form.reset(formData);

                    setRoleMapping({
                        ...detectedRoleMappingConfig,
                        mappingBuilder: {
                            ...detectedRoleMappingConfig.mappingBuilder,
                            rules: ensureMappingBuilderRuleIds(
                                detectedRoleMappingConfig.mappingBuilder.rules
                            )
                        }
                    });

                    const detectedSyncRoleMapping = detectRoleMappingConfig(
                        data.idpOrg.syncRoleMapping,
                        defaultSyncRoleMappingConfig()
                    );
                    setSyncRoleMapping({
                        ...detectedSyncRoleMapping,
                        mappingBuilder: {
                            ...detectedSyncRoleMapping.mappingBuilder,
                            rules: ensureMappingBuilderRuleIds(
                                detectedSyncRoleMapping.mappingBuilder.rules
                            )
                        }
                    });
                }
            } catch (e) {
                toast({
                    title: t("error"),
                    description: formatAxiosError(e),
                    variant: "destructive"
                });
                router.push(`/${orgId}/settings/idp`);
            } finally {
                setInitialLoading(false);
            }
        };

        const loadData = async () => {
            const rolesRes = await api
                .get<AxiosResponse<ListRolesResponse>>(`/org/${orgId}/roles`)
                .catch((e) => {
                    console.error(e);
                    toast({
                        variant: "destructive",
                        title: t("accessRoleErrorFetch"),
                        description: formatAxiosError(
                            e,
                            t("accessRoleErrorFetchDescription")
                        )
                    });
                    return null;
                });

            const availableRoles =
                rolesRes?.status === 200 ? rolesRes.data.data.roles : [];
            setRoles(availableRoles);

            await loadIdp(availableRoles);
        };

        loadData();
    }, []);

    async function onSubmit(data: GeneralFormValues) {
        setLoading(true);

        try {
            // Validate against the correct schema based on variant
            const schema = getFormSchema();
            const validationResult = schema.safeParse(data);

            if (!validationResult.success) {
                // Set form errors
                const errors = validationResult.error.flatten().fieldErrors;
                Object.keys(errors).forEach((key) => {
                    const fieldName = key as keyof GeneralFormValues;
                    const errorMessage =
                        (errors as any)[key]?.[0] || t("invalidValue");
                    form.setError(fieldName, {
                        type: "manual",
                        message: errorMessage
                    });
                });
                setLoading(false);
                return;
            }

            const roleMappingExpression =
                compileRoleMappingExpression(roleMapping);
            // linked mappings: sync uses the JIT ones
            const syncRoleMappingExpression = data.mappingsLinked
                ? roleMappingExpression
                : compileRoleMappingExpression(syncRoleMapping);
            const syncOrgMappingTrimmed =
                (data.mappingsLinked
                    ? data.orgMapping?.trim()
                    : data.syncOrgMapping?.trim()) ?? "";

            if (data.autoProvision && !roleMappingExpression) {
                toast({
                    title: t("error"),
                    description:
                        "A role mapping is required when auto-provisioning is enabled.",
                    variant: "destructive"
                });
                setLoading(false);
                return;
            }

            // Build payload based on variant
            const orgMappingTrimmed = data.orgMapping?.trim() ?? "";
            let payload: any = {
                name: data.name,
                clientId: data.clientId,
                clientSecret: data.clientSecret,
                apiIntegrationEnabled:
                    supportsApiIntegration(variant) &&
                    data.apiIntegrationEnabled,
                allowManualProvisioning: data.allowManualProvisioning,
                autoProvision: data.autoProvision,
                directorySyncEnabled:
                    supportsApiIntegration(variant) &&
                    data.apiIntegrationEnabled &&
                    data.directorySyncEnabled,
                sessionRevalidation: data.sessionRevalidation,
                roleMapping: roleMappingExpression,
                orgMapping: orgMappingTrimmed === "" ? null : orgMappingTrimmed,
                syncRoleMapping: syncRoleMappingExpression || null,
                syncOrgMapping:
                    syncOrgMappingTrimmed === "" ? null : syncOrgMappingTrimmed,
                mappingsLinked: data.mappingsLinked,
                createMissingRoles: data.createMissingRoles,
                // linked mappings: sync uses the JIT flag
                syncCreateMissingRoles: data.mappingsLinked
                    ? data.createMissingRoles
                    : data.syncCreateMissingRoles,
                directorySyncDeletions: data.directorySyncDeletions
            };

            // Add variant-specific fields
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
                    emailPath: oidcData.emailPath || "",
                    namePath: oidcData.namePath || "",
                    scopes
                };
            } else if (variant === "azure") {
                const azureData = data as AzureFormValues;
                // Construct URLs dynamically for Azure provider
                const authUrl = `https://login.microsoftonline.com/${azureData.tenantId}/oauth2/v2.0/authorize`;
                const tokenUrl = `https://login.microsoftonline.com/${azureData.tenantId}/oauth2/v2.0/token`;
                let scopes = "openid profile email";
                if (data.sessionRevalidation) {
                    scopes = scopesForSessionRevalidation(scopes, "azure");
                }
                payload = {
                    ...payload,
                    authUrl: authUrl,
                    tokenUrl: tokenUrl,
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
        const res = await api.post(`/org/${orgId}/idp/${idpId}/oidc`, payload);

        if (res.status === 200) {
            if (typeof payload.identifierPath === "string") {
                setOriginalIdentifierPath(payload.identifierPath);
            }
            setSavedApiIntegrationEnabled(
                Boolean(payload.apiIntegrationEnabled)
            );
            setSavedSyncEnabled(Boolean(payload.directorySyncEnabled));
            const apiConfig = payload.apiConfig as
                ReturnType<typeof buildGoogleIDPAPIConfig> | undefined;
            if (apiConfig?.serviceAccountKey) {
                setConfiguredServiceAccountEmail(
                    apiConfig.serviceAccountKey.client_email
                );
                form.setValue("googleServiceAccountKey", "");
            }
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
            <IdpSyncNowDialog
                open={syncDialogOpen}
                setOpen={setSyncDialogOpen}
                canApply={savedSyncEnabled}
                orgId={orgId as string}
                idpId={idpId as string}
                lastSyncedAt={lastSyncedAt}
                onSynced={setLastSyncedAt}
            />
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
                                    {t("orgIdpRedirectUrls")}
                                </InfoSectionTitle>
                                <InfoSectionContent>
                                    <CopyToClipboard text={redirectUrl} />
                                </InfoSectionContent>
                                {redirectUrl !== dashboardRedirectUrl && (
                                    <InfoSectionContent>
                                        <CopyToClipboard
                                            text={dashboardRedirectUrl}
                                        />
                                    </InfoSectionContent>
                                )}
                            </InfoSection>
                        </InfoSections>

                        {/* IDP Type Indicator */}
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

                {/* API Integration */}
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
                                        testApiBase={`/org/${orgId}/idp/${idpId}`}
                                        savedApiIntegrationEnabled={
                                            savedApiIntegrationEnabled
                                        }
                                    />
                                </form>
                            </Form>
                        </SettingsSectionBody>
                    </SettingsSection>
                )}

                {/* User Provisioning */}
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
                                id="general-settings-form"
                            >
                                <IdpUserProvisioningFields
                                    testResultsApiBase={`/org/${orgId}/idp/${idpId}`}
                                    syncAvailable={supportsApiIntegration(
                                        variant
                                    )}
                                    orgId={orgId as string}
                                    roles={roles}
                                    jitRoleMapping={roleMapping}
                                    onJitRoleMappingChange={setRoleMapping}
                                    syncRoleMapping={syncRoleMapping}
                                    onSyncRoleMappingChange={setSyncRoleMapping}
                                />
                            </form>
                        </Form>
                        {canPreviewSync && (
                            <div className="flex flex-col gap-2 items-start border-t pt-6 mt-6">
                                <Button
                                    type="button"
                                    variant="outlinePrimary"
                                    onClick={() => setSyncDialogOpen(true)}
                                    className="gap-2"
                                >
                                    <RefreshCwIcon className="size-4 flex-none" />
                                    {t("idpSyncNow")}
                                </Button>
                                <p className="text-sm text-muted-foreground">
                                    {t("idpSyncNowDescription")}
                                </p>
                                <IdpLastSyncedAt lastSyncedAt={lastSyncedAt} />
                            </div>
                        )}
                    </SettingsSectionBody>
                </SettingsSection>

                {/* Google Configuration */}
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

                {/* Azure Configuration */}
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

                {/* OIDC Configuration */}
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
                    {t("saveGeneralSettings")}
                </Button>
            </div>
        </>
    );
}
