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
import { useRouter } from "next/navigation";
import { Checkbox } from "@app/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@app/components/ui/alert";
import { InfoIcon, ExternalLink } from "lucide-react";
import { StrategySelect } from "@app/components/StrategySelect";
import { SwitchInput } from "@app/components/SwitchInput";
import { Badge } from "@app/components/ui/badge";
import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";
import { useTranslations } from "next-intl";

export default function Page() {
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const router = useRouter();
    const [createLoading, setCreateLoading] = useState(false);
    const { isUnlocked } = useLicenseStatusContext();
    const t = useTranslations();

    const createIdpFormSchema = z.object({
        name: z.string().min(2, { message: t("nameMin", { len: 2 }) }),
        type: z.enum(["oidc"]),
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
        autoProvision: z.boolean().default(false)
    });

    type CreateIdpFormValues = z.infer<typeof createIdpFormSchema>;

    interface ProviderTypeOption {
        id: "oidc";
        title: string;
        description: string;
    }

    const providerTypes: ReadonlyArray<ProviderTypeOption> = [
        {
            id: "oidc",
            title: "OAuth2/OIDC",
            description: t("idpOidcDescription")
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
            autoProvision: false
        }
    });

    async function onSubmit(data: CreateIdpFormValues) {
        setCreateLoading(true);

        try {
            const payload = {
                name: data.name,
                clientId: data.clientId,
                clientSecret: data.clientSecret,
                authUrl: data.authUrl,
                tokenUrl: data.tokenUrl,
                identifierPath: data.identifierPath,
                emailPath: data.emailPath,
                namePath: data.namePath,
                autoProvision: data.autoProvision,
                scopes: data.scopes
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

                                    <div className="flex items-start mb-0">
                                        <SwitchInput
                                            id="auto-provision-toggle"
                                            label={t("idpAutoProvisionUsers")}
                                            defaultChecked={form.getValues(
                                                "autoProvision"
                                            )}
                                            onCheckedChange={(checked) => {
                                                form.setValue(
                                                    "autoProvision",
                                                    checked
                                                );
                                            }}
                                        />
                                    </div>
                                    <span className="text-sm text-muted-foreground">
                                        {t("idpAutoProvisionUsersDescription")}
                                    </span>
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
                                    form.setValue("type", value as "oidc");
                                }}
                                cols={3}
                            />
                        </div>
                    </SettingsSectionBody>
                </SettingsSection>

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
                        router.push("/admin/idp");
                    }}
                >
                    {t("cancel")}
                </Button>
                <Button
                    type="submit"
                    disabled={createLoading}
                    loading={createLoading}
                    onClick={form.handleSubmit(onSubmit)}
                >
                    {t("idpSubmit")}
                </Button>
            </div>
        </>
    );
}
