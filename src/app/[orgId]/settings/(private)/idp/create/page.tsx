"use client";

import ApiIntegrationConfigWidget from "@app/components/ApiIntegrationConfigWidget";
import {
    buildGoogleIDPAPIConfig,
    googleDirectorySyncFormFields,
    refineGoogleDirectorySyncFields
} from "@app/components/GoogleIDPAPIConfigFields";
import IdpUserProvisioningFields from "@app/components/IdpUserProvisioningFields";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
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
import HeaderTitle from "@app/components/SettingsSectionTitle";
import { OidcIdpProviderTypeSelect } from "@app/components/idp/OidcIdpProviderTypeSelect";
import { Alert, AlertDescription, AlertTitle } from "@app/components/ui/alert";
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
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { applyOidcIdpProviderType } from "@app/lib/idp/oidcIdpProviderDefaults";
import { zodResolver } from "@hookform/resolvers/zod";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { ListRolesResponse } from "@server/routers/role";
import { AxiosResponse } from "axios";
import { InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
    compileRoleMappingExpression,
    defaultRoleMappingConfig,
    defaultSyncRoleMappingConfig,
    effectiveCreateMissingRoles,
    RoleMappingConfig
} from "@app/lib/idpRoleMapping";

export default function Page() {
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const router = useRouter();
    const [createLoading, setCreateLoading] = useState(false);
    const [roles, setRoles] = useState<{ roleId: number; name: string }[]>([]);
    const [roleMapping, setRoleMapping] = useState<RoleMappingConfig>(
        defaultRoleMappingConfig
    );
    const [syncRoleMapping, setSyncRoleMapping] = useState<RoleMappingConfig>(
        defaultSyncRoleMappingConfig
    );
    const t = useTranslations();
    const { isPaidUser } = usePaidStatus();

    const params = useParams();

    const createIdpFormSchema = z.object({
        name: z.string().min(2, { message: t("nameMin", { len: 2 }) }),
        type: z.enum(["oidc", "google", "azure"]),
        clientId: z.string().min(1, { message: t("idpClientIdRequired") }),
        clientSecret: z
            .string()
            .min(1, { message: t("idpClientSecretRequired") }),
        authUrl: z.url({ message: t("idpErrorAuthUrlInvalid") }).optional(),
        tokenUrl: z.url({ message: t("idpErrorTokenUrlInvalid") }).optional(),
        identifierPath: z
            .string()
            .min(1, { message: t("idpPathRequired") })
            .optional(),
        emailPath: z.string().optional(),
        namePath: z.string().optional(),
        scopes: z
            .string()
            .min(1, { message: t("idpScopeRequired") })
            .optional(),
        tenantId: z.string().optional(),
        apiIntegrationEnabled: z.boolean().default(false),
        allowManualProvisioning: z.boolean().default(true),
        autoProvision: z.boolean().default(false),
        roleMapping: z.string().nullable().optional(),
        roleId: z.number().nullable().optional(),
        orgMapping: z.string().optional(),
        syncOrgMapping: z.string().optional(),
        mappingsLinked: z.boolean().default(true),
        createMissingRoles: z.boolean().default(false),
        syncCreateMissingRoles: z.boolean().default(false),
        directorySyncEnabled: z.boolean().default(false),
        directorySyncDeletions: z.boolean().default(true),
        ...googleDirectorySyncFormFields
    }).superRefine((data, ctx) => {
        if (data.type === "google") {
            refineGoogleDirectorySyncFields(data, ctx, {
                keyRequired: true,
                t
            });
        }
    });

    type CreateIdpFormValues = z.infer<typeof createIdpFormSchema>;

    const form = useForm({
        resolver: zodResolver(createIdpFormSchema),
        defaultValues: {
            name: "",
            type: "oidc",
            clientId: "",
            clientSecret: "",
            authUrl: "",
            tokenUrl: "",
            identifierPath: "sub",
            namePath: "name",
            emailPath: "email",
            scopes: "openid profile email",
            tenantId: "",
            apiIntegrationEnabled: false,
            allowManualProvisioning: true,
            autoProvision: false,
            roleMapping: null,
            roleId: null,
            orgMapping: "",
            syncOrgMapping: "",
            mappingsLinked: true,
            createMissingRoles: false,
            syncCreateMissingRoles: false,
            directorySyncEnabled: false,
            directorySyncDeletions: true,
            googleServiceAccountKey: "",
            googleAdminEmail: "",
            googleCustomerId: ""
        }
    });

    // Fetch roles on component mount
    useEffect(() => {
        async function fetchRoles() {
            const res = await api
                .get<AxiosResponse<ListRolesResponse>>(
                    `/org/${params.orgId}/roles`
                )
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
                });

            if (res?.status === 200) {
                setRoles(res.data.data.roles);
            }
        }

        fetchRoles();
    }, []);

    async function onSubmit(data: CreateIdpFormValues) {
        setCreateLoading(true);

        try {
            // Construct URLs dynamically for Azure provider
            let authUrl = data.authUrl;
            let tokenUrl = data.tokenUrl;

            if (data.type === "azure" && data.tenantId) {
                authUrl = authUrl?.replace("{{TENANT_ID}}", data.tenantId);
                tokenUrl = tokenUrl?.replace("{{TENANT_ID}}", data.tenantId);
            }

            const roleMappingExpression =
                compileRoleMappingExpression(roleMapping);
            // linked mappings: sync uses the JIT ones
            const syncRoleMappingExpression = data.mappingsLinked
                ? roleMappingExpression
                : compileRoleMappingExpression(syncRoleMapping);
            const syncOrgMapping = data.mappingsLinked
                ? data.orgMapping?.trim()
                : data.syncOrgMapping?.trim();

            if (data.autoProvision && !roleMappingExpression) {
                toast({
                    title: t("error"),
                    description:
                        "A role mapping is required when auto-provisioning is enabled.",
                    variant: "destructive"
                });
                setCreateLoading(false);
                return;
            }

            const payload: Record<string, unknown> = {
                name: data.name,
                clientId: data.clientId,
                clientSecret: data.clientSecret,
                authUrl: authUrl,
                tokenUrl: tokenUrl,
                identifierPath: data.identifierPath,
                emailPath: data.emailPath,
                namePath: data.namePath,
                apiIntegrationEnabled:
                    (data.type === "google" || data.type === "azure") &&
                    data.apiIntegrationEnabled,
                allowManualProvisioning: data.allowManualProvisioning,
                autoProvision: data.autoProvision,
                directorySyncEnabled:
                    (data.type === "google" || data.type === "azure") &&
                    data.apiIntegrationEnabled &&
                    data.directorySyncEnabled,
                syncRoleMapping: syncRoleMappingExpression || null,
                syncOrgMapping: syncOrgMapping || null,
                mappingsLinked: data.mappingsLinked,
                createMissingRoles: effectiveCreateMissingRoles(
                    roleMapping,
                    data.createMissingRoles
                ),
                // linked mappings: sync uses the JIT flag
                syncCreateMissingRoles: data.mappingsLinked
                    ? effectiveCreateMissingRoles(
                          roleMapping,
                          data.createMissingRoles
                      )
                    : effectiveCreateMissingRoles(
                          syncRoleMapping,
                          data.syncCreateMissingRoles
                      ),
                directorySyncDeletions: data.directorySyncDeletions,
                roleMapping: roleMappingExpression,
                scopes: data.scopes,
                variant: data.type
            };
            if (data.type === "google") {
                payload.apiConfig =
                    buildGoogleIDPAPIConfig(data);
            }
            const trimmedOrgMapping = data.orgMapping?.trim();
            if (trimmedOrgMapping) {
                payload.orgMapping = trimmedOrgMapping;
            }

            // Use the appropriate endpoint based on provider type
            const endpoint = "oidc";
            const res = await api.put(
                `/org/${params.orgId}/idp/${endpoint}`,
                payload
            );

            if (res.status === 201) {
                toast({
                    title: t("success"),
                    description: t("idpCreatedDescription")
                });
                router.push(
                    `/${params.orgId}/settings/idp/${res.data.data.idpId}`
                );
            }
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        } finally {
            setCreateLoading(false);
        }
    }

    const disabled = !isPaidUser(tierMatrix.orgOidc);

    return (
        <>
            <div className="flex justify-between">
                <HeaderTitle
                    title={t("idpCreate")}
                    description={t("idpCreateDescription")}
                />
                <Button
                    variant="outline"
                    onClick={() => {
                        router.push(`/${params.orgId}/settings/idp`);
                    }}
                >
                    {t("idpSeeAll")}
                </Button>
            </div>

            <PaidFeaturesAlert tiers={tierMatrix.orgOidc} />

            <fieldset
                disabled={disabled}
                className={disabled ? "opacity-50 pointer-events-none" : ""}
            >
                <SettingsContainer>
                    <SettingsSection>
                        <SettingsSectionHeader>
                            <SettingsSectionTitle>
                                {t("idpTitle")}
                            </SettingsSectionTitle>
                            <SettingsSectionDescription>
                                {t("idpCreateSettingsDescription")}
                            </SettingsSectionDescription>
                        </SettingsSectionHeader>
                        <SettingsSectionBody>
                            <OidcIdpProviderTypeSelect
                                value={form.watch("type")}
                                onTypeChange={(next) => {
                                    applyOidcIdpProviderType(
                                        form.setValue,
                                        next
                                    );
                                }}
                            />

                            <SettingsSectionForm>
                                <Form {...form}>
                                    <form
                                        className="space-y-4"
                                        id="create-idp-form"
                                        onSubmit={form.handleSubmit(onSubmit)}
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
                                    </form>
                                </Form>
                            </SettingsSectionForm>
                        </SettingsSectionBody>
                    </SettingsSection>

                    {/* API Integration */}
                    {(form.watch("type") === "google" ||
                        form.watch("type") === "azure") && (
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
                                        className="space-y-4"
                                        id="create-idp-form"
                                        onSubmit={form.handleSubmit(onSubmit)}
                                    >
                                        <ApiIntegrationConfigWidget
                                            variant={
                                                form.watch("type") as
                                                    | "google"
                                                    | "azure"
                                            }
                                            apiIntegrationEnabled={
                                                form.watch(
                                                    "apiIntegrationEnabled"
                                                ) ?? false
                                            }
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
                                    id="create-idp-form"
                                    onSubmit={form.handleSubmit(onSubmit)}
                                >
                                    <IdpUserProvisioningFields
                                        syncAvailable={
                                            form.watch("type") === "google" ||
                                            form.watch("type") === "azure"
                                        }
                                        orgId={params.orgId as string}
                                        roles={roles}
                                        jitRoleMapping={roleMapping}
                                        onJitRoleMappingChange={setRoleMapping}
                                        syncRoleMapping={syncRoleMapping}
                                        onSyncRoleMappingChange={
                                            setSyncRoleMapping
                                        }
                                    />
                                </form>
                            </Form>
                        </SettingsSectionBody>
                    </SettingsSection>

                    {form.watch("type") === "google" && (
                        <SettingsSection>
                            <SettingsSectionHeader>
                                <SettingsSectionTitle>
                                    {t("idpGoogleConfigurationTitle")}
                                </SettingsSectionTitle>
                                <SettingsSectionDescription>
                                    {t("idpGoogleConfigurationDescription")}
                                </SettingsSectionDescription>
                            </SettingsSectionHeader>
                            <SettingsSectionBody>
                                <SettingsSectionForm>
                                    <Form {...form}>
                                        <form
                                            className="space-y-4"
                                            id="create-idp-form"
                                            onSubmit={form.handleSubmit(
                                                onSubmit
                                            )}
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

                    {form.watch("type") === "azure" && (
                        <SettingsSection>
                            <SettingsSectionHeader>
                                <SettingsSectionTitle>
                                    {t("idpAzureConfigurationTitle")}
                                </SettingsSectionTitle>
                                <SettingsSectionDescription>
                                    {t("idpAzureConfigurationDescription")}
                                </SettingsSectionDescription>
                            </SettingsSectionHeader>
                            <SettingsSectionBody>
                                <SettingsSectionForm>
                                    <Form {...form}>
                                        <form
                                            className="space-y-4"
                                            id="create-idp-form"
                                            onSubmit={form.handleSubmit(
                                                onSubmit
                                            )}
                                        >
                                            <FormField
                                                control={form.control}
                                                name="tenantId"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t(
                                                                "idpTenantIdLabel"
                                                            )}
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
                                                                "idpAzureClientIdDescription2"
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
                                                                "idpAzureClientSecretDescription2"
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

                    {form.watch("type") === "oidc" && (
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
                                    <Form {...form}>
                                        <form
                                            className="space-y-4"
                                            id="create-idp-form"
                                            onSubmit={form.handleSubmit(
                                                onSubmit
                                            )}
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
                                                            <Input
                                                                placeholder="https://your-idp.com/oauth2/authorize"
                                                                {...field}
                                                            />
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
                                                            <Input
                                                                placeholder="https://your-idp.com/oauth2/token"
                                                                {...field}
                                                            />
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
                                    <Form {...form}>
                                        <form
                                            className="space-y-4"
                                            id="create-idp-form"
                                            onSubmit={form.handleSubmit(
                                                onSubmit
                                            )}
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
                                                            <Input {...field} />
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
                                                            <Input {...field} />
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
                                </SettingsSectionBody>
                            </SettingsSection>
                        </SettingsSectionGrid>
                    )}
                </SettingsContainer>

                <div className="flex justify-end space-x-2 mt-8">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                            router.push(`/${params.orgId}/settings/idp`);
                        }}
                    >
                        {t("cancel")}
                    </Button>
                    <Button
                        type="submit"
                        disabled={createLoading || disabled}
                        loading={createLoading}
                        onClick={() => {
                            if (disabled) return;
                            // log any issues with the form
                            console.log(form.formState.errors);
                            form.handleSubmit(onSubmit)();
                        }}
                    >
                        {t("idpSubmit")}
                    </Button>
                </div>
            </fieldset>
        </>
    );
}
