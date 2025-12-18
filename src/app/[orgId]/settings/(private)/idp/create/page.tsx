"use client";

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
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import HeaderTitle from "@app/components/SettingsSectionTitle";
import { z } from "zod";
import { createElement, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@app/components/ui/input";
import { Button } from "@app/components/ui/button";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { useParams, useRouter } from "next/navigation";
import { Checkbox } from "@app/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@app/components/ui/alert";
import { InfoIcon, ExternalLink } from "lucide-react";
import { StrategySelect } from "@app/components/StrategySelect";
import { SwitchInput } from "@app/components/SwitchInput";
import { Badge } from "@app/components/ui/badge";
import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";
import { useTranslations } from "next-intl";
import Image from "next/image";
import AutoProvisionConfigWidget from "@app/components/private/AutoProvisionConfigWidget";
import { AxiosResponse } from "axios";
import { ListRolesResponse } from "@server/routers/role";

export default function Page() {
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const router = useRouter();
    const [createLoading, setCreateLoading] = useState(false);
    const [roles, setRoles] = useState<{ roleId: number; name: string }[]>([]);
    const [roleMappingMode, setRoleMappingMode] = useState<
        "role" | "expression"
    >("role");
    const { isUnlocked } = useLicenseStatusContext();
    const t = useTranslations();

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
        autoProvision: z.boolean().default(false),
        roleMapping: z.string().nullable().optional(),
        roleId: z.number().nullable().optional()
    });

    type CreateIdpFormValues = z.infer<typeof createIdpFormSchema>;

    interface ProviderTypeOption {
        id: "oidc" | "google" | "azure";
        title: string;
        description: string;
        icon?: React.ReactNode;
    }

    const providerTypes: ReadonlyArray<ProviderTypeOption> = [
        {
            id: "oidc",
            title: "OAuth2/OIDC",
            description: t("idpOidcDescription")
        },
        {
            id: "google",
            title: t("idpGoogleTitle"),
            description: t("idpGoogleDescription"),
            icon: (
                <Image
                    src="/idp/google.png"
                    alt={t("idpGoogleAlt")}
                    width={24}
                    height={24}
                    className="rounded"
                />
            )
        },
        {
            id: "azure",
            title: t("idpAzureTitle"),
            description: t("idpAzureDescription"),
            icon: (
                <Image
                    src="/idp/azure.png"
                    alt={t("idpAzureAlt")}
                    width={24}
                    height={24}
                    className="rounded"
                />
            )
        }
    ];

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
            autoProvision: false,
            roleMapping: null,
            roleId: null
        }
    });

    // Fetch roles on component mount
    useEffect(() => {
        async function fetchRoles() {
            const res = await api
                .get<
                    AxiosResponse<ListRolesResponse>
                >(`/org/${params.orgId}/roles`)
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

    // Handle provider type changes and set defaults
    const handleProviderChange = (value: "oidc" | "google" | "azure") => {
        form.setValue("type", value);

        if (value === "google") {
            // Set Google defaults
            form.setValue(
                "authUrl",
                "https://accounts.google.com/o/oauth2/v2/auth"
            );
            form.setValue("tokenUrl", "https://oauth2.googleapis.com/token");
            form.setValue("identifierPath", "email");
            form.setValue("emailPath", "email");
            form.setValue("namePath", "name");
            form.setValue("scopes", "openid profile email");
        } else if (value === "azure") {
            // Set Azure Entra ID defaults (URLs will be constructed dynamically)
            form.setValue(
                "authUrl",
                "https://login.microsoftonline.com/{{TENANT_ID}}/oauth2/v2.0/authorize"
            );
            form.setValue(
                "tokenUrl",
                "https://login.microsoftonline.com/{{TENANT_ID}}/oauth2/v2.0/token"
            );
            form.setValue("identifierPath", "email");
            form.setValue("emailPath", "email");
            form.setValue("namePath", "name");
            form.setValue("scopes", "openid profile email");
            form.setValue("tenantId", "");
        } else {
            // Reset to OIDC defaults
            form.setValue("authUrl", "");
            form.setValue("tokenUrl", "");
            form.setValue("identifierPath", "sub");
            form.setValue("namePath", "name");
            form.setValue("emailPath", "email");
            form.setValue("scopes", "openid profile email");
        }
    };

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

            const roleName = roles.find((r) => r.roleId === data.roleId)?.name;

            const payload = {
                name: data.name,
                clientId: data.clientId,
                clientSecret: data.clientSecret,
                authUrl: authUrl,
                tokenUrl: tokenUrl,
                identifierPath: data.identifierPath,
                emailPath: data.emailPath,
                namePath: data.namePath,
                autoProvision: data.autoProvision,
                roleMapping:
                    roleMappingMode === "role"
                        ? `'${roleName}'`
                        : data.roleMapping || "",
                scopes: data.scopes,
                variant: data.type
            };

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
                        router.push("/admin/idp");
                    }}
                >
                    {t("idpSeeAll")}
                </Button>
            </div>

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

                        <div>
                            <div className="mb-2">
                                <span className="text-sm font-medium">
                                    {t("idpType")}
                                </span>
                            </div>
                            <StrategySelect
                                options={providerTypes}
                                defaultValue={form.getValues("type")}
                                onChange={(value) => {
                                    handleProviderChange(
                                        value as "oidc" | "google" | "azure"
                                    );
                                }}
                                cols={3}
                            />
                        </div>
                    </SettingsSectionBody>
                </SettingsSection>

                {/* Auto Provision Settings */}
                <SettingsSection>
                    <SettingsSectionHeader>
                        <SettingsSectionTitle>
                            {t("idpAutoProvisionUsers")}
                        </SettingsSectionTitle>
                        <SettingsSectionDescription>
                            {t("idpAutoProvisionUsersDescription")}
                        </SettingsSectionDescription>
                    </SettingsSectionHeader>
                    <SettingsSectionBody>
                        <SettingsSectionForm>
                            <Form {...form}>
                                <form
                                    className="space-y-4"
                                    id="create-idp-form"
                                    onSubmit={form.handleSubmit(onSubmit)}
                                >
                                    <AutoProvisionConfigWidget
                                        control={form.control}
                                        autoProvision={
                                            form.watch(
                                                "autoProvision"
                                            ) as boolean
                                        } // is this right?
                                        onAutoProvisionChange={(checked) => {
                                            form.setValue(
                                                "autoProvision",
                                                checked
                                            );
                                        }}
                                        roleMappingMode={roleMappingMode}
                                        onRoleMappingModeChange={(data) => {
                                            setRoleMappingMode(data);
                                            // Clear roleId and roleMapping when mode changes
                                            form.setValue("roleId", null);
                                            form.setValue("roleMapping", null);
                                        }}
                                        roles={roles}
                                        roleIdFieldName="roleId"
                                        roleMappingFieldName="roleMapping"
                                    />
                                </form>
                            </Form>
                        </SettingsSectionForm>
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
                                        onSubmit={form.handleSubmit(onSubmit)}
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
                                        onSubmit={form.handleSubmit(onSubmit)}
                                    >
                                        <FormField
                                            control={form.control}
                                            name="tenantId"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t("idpTenantIdLabel")}
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
                                        onSubmit={form.handleSubmit(onSubmit)}
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

                                <Alert variant="neutral">
                                    <InfoIcon className="h-4 w-4" />
                                    <AlertTitle className="font-semibold">
                                        {t("idpOidcConfigureAlert")}
                                    </AlertTitle>
                                    <AlertDescription>
                                        {t("idpOidcConfigureAlertDescription")}
                                    </AlertDescription>
                                </Alert>
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
                                        onSubmit={form.handleSubmit(onSubmit)}
                                    >
                                        <Alert variant="neutral">
                                            <InfoIcon className="h-4 w-4" />
                                            <AlertTitle className="font-semibold">
                                                {t("idpJmespathAbout")}
                                            </AlertTitle>
                                            <AlertDescription>
                                                {t(
                                                    "idpJmespathAboutDescription"
                                                )}{" "}
                                                <a
                                                    href="https://jmespath.org"
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-primary hover:underline inline-flex items-center"
                                                >
                                                    {t(
                                                        "idpJmespathAboutDescriptionLink"
                                                    )}{" "}
                                                    <ExternalLink className="ml-1 h-4 w-4" />
                                                </a>
                                            </AlertDescription>
                                        </Alert>

                                        <FormField
                                            control={form.control}
                                            name="identifierPath"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t("idpJmespathLabel")}
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
                    disabled={createLoading}
                    loading={createLoading}
                    onClick={() => {
                        // log any issues with the form
                        console.log(form.formState.errors);
                        form.handleSubmit(onSubmit)();
                    }}
                >
                    {t("idpSubmit")}
                </Button>
            </div>
        </>
    );
}
