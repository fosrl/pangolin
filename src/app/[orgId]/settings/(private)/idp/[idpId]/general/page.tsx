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
import { useForm } from "react-hook-form";
import { toast } from "@app/hooks/useToast";
import { useRouter, useParams, redirect } from "next/navigation";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionHeader,
    SettingsSectionTitle,
    SettingsSectionDescription,
    SettingsSectionBody,
    SettingsSectionForm,
    SettingsSectionFooter,
    SettingsSectionGrid
} from "@app/components/Settings";
import { formatAxiosError } from "@app/lib/api";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useState, useEffect } from "react";
import { Alert, AlertDescription, AlertTitle } from "@app/components/ui/alert";
import { InfoIcon, ExternalLink } from "lucide-react";
import {
    InfoSection,
    InfoSectionContent,
    InfoSections,
    InfoSectionTitle
} from "@app/components/InfoSection";
import CopyToClipboard from "@app/components/CopyToClipboard";
import IdpTypeBadge from "@app/components/IdpTypeBadge";
import { useTranslations } from "next-intl";
import { AxiosResponse } from "axios";
import { ListRolesResponse } from "@server/routers/role";
import AutoProvisionConfigWidget from "@app/components/AutoProvisionConfigWidget";
import IdpAutoProvisionUsersDescription from "@app/components/IdpAutoProvisionUsersDescription";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import {
    compileRoleMappingExpression,
    createMappingBuilderRule,
    detectRoleMappingConfig,
    ensureMappingBuilderRuleIds,
    MappingBuilderRule,
    RoleMappingMode
} from "@app/lib/idpRoleMapping";

export default function GeneralPage() {
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const router = useRouter();
    const { idpId, orgId } = useParams();
    const [loading, setLoading] = useState(false);
    const [initialLoading, setInitialLoading] = useState(true);
    const [roles, setRoles] = useState<{ roleId: number; name: string }[]>([]);
    const [roleMappingMode, setRoleMappingMode] =
        useState<RoleMappingMode>("fixedRoles");
    const [fixedRoleNames, setFixedRoleNames] = useState<string[]>([]);
    const [mappingBuilderClaimPath, setMappingBuilderClaimPath] =
        useState("groups");
    const [mappingBuilderRules, setMappingBuilderRules] = useState<
        MappingBuilderRule[]
    >([createMappingBuilderRule()]);
    const [rawRoleExpression, setRawRoleExpression] = useState("");
    const [variant, setVariant] = useState<"oidc">("oidc");

    const dashboardRedirectUrl = `${env.app.dashboardUrl}/auth/idp/${idpId}/oidc/callback`;
    const [redirectUrl, setRedirectUrl] = useState(
        `${env.app.dashboardUrl}/auth/idp/${idpId}/oidc/callback`
    );
    const t = useTranslations();

    // OIDC form schema (full configuration)
    const OidcFormSchema = z.object({
        name: z.string().min(2, { message: t("nameMin", { len: 2 }) }),
        clientId: z.string().min(1, { message: t("idpClientIdRequired") }),
        clientSecret: z
            .string()
            .min(1, { message: t("idpClientSecretRequired") }),
        roleMapping: z.string().nullable().optional(),
        roleId: z.number().nullable().optional(),
        discoveryUrl: z.url({ message: t("idpErrorDiscoveryUrlInvalid") }),
        identifierPath: z.string().min(1, { message: t("idpPathRequired") }),
        emailPath: z.string().nullable().optional(),
        namePath: z.string().nullable().optional(),
        scopes: z.string().min(1, { message: t("idpScopeRequired") }),
        autoProvision: z.boolean().default(false),
        orgMapping: z.string().optional()
    });

    // // Google form schema (simplified)
    // const GoogleFormSchema = z.object({
    //     name: z.string().min(2, { message: t("nameMin", { len: 2 }) }),
    //     clientId: z.string().min(1, { message: t("idpClientIdRequired") }),
    //     clientSecret: z
    //         .string()
    //         .min(1, { message: t("idpClientSecretRequired") }),
    //     roleMapping: z.string().nullable().optional(),
    //     roleId: z.number().nullable().optional(),
    //     autoProvision: z.boolean().default(false),
    //     orgMapping: z.string().optional()
    // });
    //
    // // Azure form schema (simplified with tenant ID)
    // const AzureFormSchema = z.object({
    //     name: z.string().min(2, { message: t("nameMin", { len: 2 }) }),
    //     clientId: z.string().min(1, { message: t("idpClientIdRequired") }),
    //     clientSecret: z
    //         .string()
    //         .min(1, { message: t("idpClientSecretRequired") }),
    //     tenantId: z.string().min(1, { message: t("idpTenantIdRequired") }),
    //     roleMapping: z.string().nullable().optional(),
    //     roleId: z.number().nullable().optional(),
    //     autoProvision: z.boolean().default(false),
    //     orgMapping: z.string().optional()
    // });

    type OidcFormValues = z.infer<typeof OidcFormSchema>;
    // type GoogleFormValues = z.infer<typeof GoogleFormSchema>;
    // type AzureFormValues = z.infer<typeof AzureFormSchema>;
    // type GeneralFormValues =
    //     | OidcFormValues
    //     | GoogleFormValues
    //     | AzureFormValues;
    type GeneralFormValues = OidcFormValues;

    // Get the appropriate schema based on variant
    const getFormSchema = () => {
        switch (variant) {
            // case "google":
            //     return GoogleFormSchema;
            // case "azure":
            //     return AzureFormSchema;
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
            discoveryUrl: "",
            identifierPath: "sub",
            emailPath: "email",
            namePath: "name",
            scopes: "openid profile email",
            autoProvision: true,
            roleMapping: null,
            roleId: null,
            orgMapping: ""
        }
    });

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
                    setRedirectUrl(res.data.data.redirectUrl);

                    // Set the variant
                    setVariant(idpVariant as "oidc");

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
                        autoProvision: data.idp.autoProvision,
                        roleMapping: roleMapping || null,
                        roleId: null,
                        orgMapping: data.idpOrg?.orgMapping ?? ""
                    };

                    // Add variant-specific fields
                    if (idpVariant === "oidc") {
                        formData.discoveryUrl = data.idpOidcConfig.discoveryUrl;
                        formData.identifierPath =
                            data.idpOidcConfig.identifierPath;
                        formData.emailPath =
                            data.idpOidcConfig.emailPath || null;
                        formData.namePath = data.idpOidcConfig.namePath || null;
                        formData.scopes = data.idpOidcConfig.scopes;
                    } else if (idpVariant === "azure") {
                        formData.tenantId = tenantId;
                    }

                    form.reset(formData);

                    setRoleMappingMode(detectedRoleMappingConfig.mode);
                    setFixedRoleNames(detectedRoleMappingConfig.fixedRoleNames);
                    setMappingBuilderClaimPath(
                        detectedRoleMappingConfig.mappingBuilder.claimPath
                    );
                    setMappingBuilderRules(
                        ensureMappingBuilderRuleIds(
                            detectedRoleMappingConfig.mappingBuilder.rules
                        )
                    );
                    setRawRoleExpression(
                        detectedRoleMappingConfig.rawExpression
                    );
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

            const roleMappingExpression = compileRoleMappingExpression({
                mode: roleMappingMode,
                fixedRoleNames,
                mappingBuilder: {
                    claimPath: mappingBuilderClaimPath,
                    rules: mappingBuilderRules
                },
                rawExpression: rawRoleExpression
            });

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
                autoProvision: data.autoProvision,
                roleMapping: roleMappingExpression,
                orgMapping: orgMappingTrimmed === "" ? null : orgMappingTrimmed
            };

            // Add variant-specific fields
            if (variant === "oidc") {
                const oidcData = data as OidcFormValues;
                payload = {
                    ...payload,
                    discoveryUrl: oidcData.discoveryUrl,
                    identifierPath: oidcData.identifierPath,
                    emailPath: oidcData.emailPath || "",
                    namePath: oidcData.namePath || "",
                    scopes: oidcData.scopes
                };
            }
            // } else if (variant === "azure") {
            //     // const azureData = data as AzureFormValues;
            //     // // Construct URLs dynamically for Azure provider
            //     // const authUrl = `https://login.microsoftonline.com/${azureData.tenantId}/oauth2/v2.0/authorize`;
            //     // const tokenUrl = `https://login.microsoftonline.com/${azureData.tenantId}/oauth2/v2.0/token`;
            //     // payload = {
            //     //     ...payload,
            //     //     authUrl: authUrl,
            //     //     tokenUrl: tokenUrl,
            //     //     identifierPath: "email",
            //     //     emailPath: "email",
            //     //     namePath: "name",
            //     //     scopes: "openid profile email"
            //     // };
            // } else if (variant === "google") {
            //     // // Google uses predefined URLs
            //     // payload = {
            //     //     ...payload,
            //     //     authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
            //     //     tokenUrl: "https://oauth2.googleapis.com/token",
            //     //     identifierPath: "email",
            //     //     emailPath: "email",
            //     //     namePath: "name",
            //     //     scopes: "openid profile email"
            //     // };
            // }

            const res = await api.post(
                `/org/${orgId}/idp/${idpId}/oidc`,
                payload
            );

            if (res.status === 200) {
                toast({
                    title: t("success"),
                    description: t("idpUpdatedDescription")
                });
                router.refresh();
            }
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
                                </form>
                            </Form>
                        </SettingsSectionForm>
                    </SettingsSectionBody>
                </SettingsSection>

                {/* Auto Provision Settings */}
                <SettingsSection>
                    <SettingsSectionHeader>
                        <SettingsSectionTitle>
                            {t("idpAutoProvisionUsers")}
                        </SettingsSectionTitle>
                        <SettingsSectionDescription>
                            <IdpAutoProvisionUsersDescription />
                        </SettingsSectionDescription>
                    </SettingsSectionHeader>
                    <SettingsSectionBody>
                        <PaidFeaturesAlert
                            tiers={tierMatrix.autoProvisioning}
                        />

                        <Form {...form}>
                            <form
                                onSubmit={form.handleSubmit(onSubmit)}
                                className="space-y-4"
                                id="general-settings-form"
                            >
                                <AutoProvisionConfigWidget
                                    autoProvision={form.watch("autoProvision")}
                                    onAutoProvisionChange={(checked) => {
                                        form.setValue("autoProvision", checked);
                                    }}
                                    orgId={orgId as string}
                                    roleMappingMode={roleMappingMode}
                                    onRoleMappingModeChange={(data) => {
                                        setRoleMappingMode(data);
                                    }}
                                    roles={roles}
                                    fixedRoleNames={fixedRoleNames}
                                    onFixedRoleNamesChange={setFixedRoleNames}
                                    mappingBuilderClaimPath={
                                        mappingBuilderClaimPath
                                    }
                                    onMappingBuilderClaimPathChange={
                                        setMappingBuilderClaimPath
                                    }
                                    mappingBuilderRules={mappingBuilderRules}
                                    onMappingBuilderRulesChange={
                                        setMappingBuilderRules
                                    }
                                    rawExpression={rawRoleExpression}
                                    onRawExpressionChange={setRawRoleExpression}
                                    orgMappingField={{
                                        control: form.control,
                                        name: "orgMapping"
                                    }}
                                />
                            </form>
                        </Form>
                    </SettingsSectionBody>
                </SettingsSection>

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
                                                name="discoveryUrl"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t(
                                                                "idpDiscoveryUrl"
                                                            )}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input {...field} />
                                                        </FormControl>
                                                        <FormDescription>
                                                            {t(
                                                                "idpDiscoveryUrlDescription"
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
