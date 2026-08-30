"use client";

import AutoProvisionConfigWidget from "@app/components/AutoProvisionConfigWidget";
import IdpAutoProvisionUsersDescription from "@app/components/IdpAutoProvisionUsersDescription";
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
    createMappingBuilderRule,
    MappingBuilderRule,
    RoleMappingMode
} from "@app/lib/idpRoleMapping";

export default function Page() {
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const router = useRouter();
    const [createLoading, setCreateLoading] = useState(false);
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
        discoveryUrl: z.url({ message: t("idpErrorDiscoveryUrlInvalid") }).optional(),
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
        roleId: z.number().nullable().optional(),
        orgMapping: z.string().optional()
    });

    type CreateIdpFormValues = z.infer<typeof createIdpFormSchema>;

    const form = useForm({
        resolver: zodResolver(createIdpFormSchema),
        defaultValues: {
            name: "",
            type: "oidc",
            clientId: "",
            clientSecret: "",
            discoveryUrl: "",
            identifierPath: "sub",
            namePath: "name",
            emailPath: "email",
            scopes: "openid profile email",
            tenantId: "",
            autoProvision: false,
            roleMapping: null,
            roleId: null,
            orgMapping: ""
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

    async function onSubmit(data: CreateIdpFormValues) {
        setCreateLoading(true);

        try {
            // Construct URLs dynamically for Azure provider
            // let authUrl = data.authUrl;
            // let tokenUrl = data.tokenUrl;

            // if (data.type === "azure" && data.tenantId) {
            //     authUrl = authUrl?.replace("{{TENANT_ID}}", data.tenantId);
            //     tokenUrl = tokenUrl?.replace("{{TENANT_ID}}", data.tenantId);
            // }

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
                setCreateLoading(false);
                return;
            }

            const payload: Record<string, unknown> = {
                name: data.name,
                clientId: data.clientId,
                clientSecret: data.clientSecret,
                discoveryUrl: data.discoveryUrl,
                identifierPath: data.identifierPath,
                emailPath: data.emailPath,
                namePath: data.namePath,
                autoProvision: data.autoProvision,
                roleMapping: roleMappingExpression,
                scopes: data.scopes,
                variant: data.type
            };
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
                                    className="space-y-4"
                                    id="create-idp-form"
                                    onSubmit={form.handleSubmit(onSubmit)}
                                >
                                    <AutoProvisionConfigWidget
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
                                        orgId={params.orgId as string}
                                        roleMappingMode={roleMappingMode}
                                        onRoleMappingModeChange={(data) => {
                                            setRoleMappingMode(data);
                                        }}
                                        roles={roles}
                                        fixedRoleNames={fixedRoleNames}
                                        onFixedRoleNamesChange={
                                            setFixedRoleNames
                                        }
                                        mappingBuilderClaimPath={
                                            mappingBuilderClaimPath
                                        }
                                        onMappingBuilderClaimPathChange={
                                            setMappingBuilderClaimPath
                                        }
                                        mappingBuilderRules={
                                            mappingBuilderRules
                                        }
                                        onMappingBuilderRulesChange={
                                            setMappingBuilderRules
                                        }
                                        rawExpression={rawRoleExpression}
                                        onRawExpressionChange={
                                            setRawRoleExpression
                                        }
                                        orgMappingField={{
                                            control: form.control,
                                            name: "orgMapping"
                                        }}
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
                                                name="discoveryUrl"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t(
                                                                "idpDiscoveryUrl"
                                                            )}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                placeholder="https://your-idp.com/.well-known/openid-configuration"
                                                                {...field}
                                                            />
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
