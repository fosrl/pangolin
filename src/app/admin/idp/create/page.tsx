"use client";

import { OidcIdpProviderTypeSelect } from "@app/components/idp/OidcIdpProviderTypeSelect";
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
import IdpAutoProvisionUsersDescription from "@app/components/IdpAutoProvisionUsersDescription";
import { SwitchInput } from "@app/components/SwitchInput";
import { Button } from "@app/components/ui/button";
import { Input } from "@app/components/ui/input";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { applyOidcIdpProviderType } from "@app/lib/idp/oidcIdpProviderDefaults";
import { zodResolver } from "@hookform/resolvers/zod";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

export default function Page() {
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const router = useRouter();
    const [createLoading, setCreateLoading] = useState(false);
    const t = useTranslations();
    const { isPaidUser } = usePaidStatus();
    const templatesPaid = isPaidUser(tierMatrix.orgOidc);

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
        autoProvision: z.boolean().default(false)
    });

    type CreateIdpFormValues = z.infer<typeof createIdpFormSchema>;

    const form = useForm({
        resolver: zodResolver(createIdpFormSchema),
        defaultValues: {
            name: "",
            type: "oidc" as const,
            clientId: "",
            clientSecret: "",
            authUrl: "",
            tokenUrl: "",
            identifierPath: "sub",
            namePath: "name",
            emailPath: "email",
            scopes: "openid profile email",
            tenantId: "",
            autoProvision: false
        }
    });

    const watchedType = form.watch("type");
    const templatesLocked =
        !templatesPaid && (watchedType === "google" || watchedType === "azure");

    async function onSubmit(data: CreateIdpFormValues) {
        if (
            !templatesPaid &&
            (data.type === "google" || data.type === "azure")
        ) {
            return;
        }

        setCreateLoading(true);

        try {
            let authUrl = data.authUrl;
            let tokenUrl = data.tokenUrl;

            if (data.type === "azure" && data.tenantId) {
                authUrl = authUrl?.replace("{{TENANT_ID}}", data.tenantId);
                tokenUrl = tokenUrl?.replace("{{TENANT_ID}}", data.tenantId);
            }

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
                scopes: data.scopes,
                variant: data.type
            };

            const res = await api.put("/idp/oidc", payload);

            if (res.status === 201) {
                toast({
                    title: t("success"),
                    description: t("idpCreatedDescription")
                });
                router.push(`/admin/idp/${res.data.data.idpId}`);
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
                        {templatesLocked ? (
                            <div className="mb-4">
                                <PaidFeaturesAlert tiers={tierMatrix.orgOidc} />
                            </div>
                        ) : null}
                        <OidcIdpProviderTypeSelect
                            value={watchedType}
                            onTypeChange={(next) => {
                                applyOidcIdpProviderType(form.setValue, next);
                            }}
                        />

                        <fieldset
                            disabled={templatesLocked}
                            className="min-w-0 border-0 p-0 m-0 disabled:pointer-events-none disabled:opacity-60"
                        >
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
                        </fieldset>
                    </SettingsSectionBody>
                </SettingsSection>

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
                        <div className="space-y-2">
                            <SwitchInput
                                id="auto-provision-toggle"
                                label={t("idpAutoProvisionUsers")}
                                defaultChecked={form.getValues("autoProvision")}
                                onCheckedChange={(checked) => {
                                    form.setValue("autoProvision", checked);
                                }}
                                description={t("idpAutoProvisionConfigureAfterCreate")}
                            />
                        </div>
                    </SettingsSectionBody>
                </SettingsSection>

                <fieldset
                    disabled={templatesLocked}
                    className="min-w-0 border-0 p-0 m-0 disabled:pointer-events-none disabled:opacity-60"
                >
                    {watchedType === "google" && (
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

                    {watchedType === "azure" && (
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

                    {watchedType === "oidc" && (
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
                </fieldset>
            </SettingsContainer>

            <div className="flex justify-end space-x-2 mt-8">
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                        router.push("/admin/idp");
                    }}
                >
                    {t("cancel")}
                </Button>
                <Button
                    type="submit"
                    disabled={createLoading || templatesLocked}
                    loading={createLoading}
                    onClick={form.handleSubmit(onSubmit)}
                >
                    {t("idpSubmit")}
                </Button>
            </div>
        </>
    );
}
