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
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@app/components/ui/input";
import { Checkbox } from "@app/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@app/components/ui/alert";
import { InfoIcon, ExternalLink } from "lucide-react";
import { StrategySelect } from "@app/components/StrategySelect";
import IdpAutoProvisionUsersDescription from "@app/components/IdpAutoProvisionUsersDescription";
import { SwitchInput } from "@app/components/SwitchInput";
import { Badge } from "@app/components/ui/badge";
import { useTranslations } from "next-intl";

type CreateIdpFormValues = {
    name: string;
    type: "oidc";
    clientId: string;
    clientSecret: string;
    authUrl: string;
    tokenUrl: string;
    identifierPath: string;
    emailPath?: string;
    namePath?: string;
    scopes: string;
    autoProvision: boolean;
};

type IdpCreateWizardProps = {
    onSubmit: (data: CreateIdpFormValues) => void | Promise<void>;
    defaultValues?: Partial<CreateIdpFormValues>;
    loading?: boolean;
};

export function IdpCreateWizard({
    onSubmit,
    defaultValues,
    loading = false
}: IdpCreateWizardProps) {
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
            autoProvision: false,
            ...defaultValues
        }
    });

    const handleSubmit = (data: CreateIdpFormValues) => {
        onSubmit(data);
    };

    return (
        <SettingsContainer>
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>{t("idpTitle")}</SettingsSectionTitle>
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
                                onSubmit={form.handleSubmit(handleSubmit)}
                            >
                                <FormField
                                    control={form.control}
                                    name="name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t("name")}</FormLabel>
                                            <FormControl>
                                                <Input
                                                    {...field}
                                                    disabled={loading}
                                                />
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
                                        disabled={loading}
                                    />
                                </div>
                            </form>
                        </Form>
                    </SettingsSectionForm>
                </SettingsSectionBody>
            </SettingsSection>

            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>{t("idpType")}</SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("idpTypeDescription")}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>
                <SettingsSectionBody>
                    <StrategySelect
                        options={providerTypes}
                        defaultValue={form.getValues("type")}
                        onChange={(value) => {
                            form.setValue("type", value as "oidc");
                        }}
                        cols={3}
                    />
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
                                    onSubmit={form.handleSubmit(handleSubmit)}
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
                                                    <Input
                                                        {...field}
                                                        disabled={loading}
                                                    />
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
                                                        disabled={loading}
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
                                                        disabled={loading}
                                                    />
                                                </FormControl>
                                                <FormDescription>
                                                    {t("idpAuthUrlDescription")}
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
                                                        disabled={loading}
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
                                    onSubmit={form.handleSubmit(handleSubmit)}
                                >
                                    <Alert variant="neutral">
                                        <InfoIcon className="h-4 w-4" />
                                        <AlertTitle className="font-semibold">
                                            {t("idpJmespathAbout")}
                                        </AlertTitle>
                                        <AlertDescription>
                                            {t("idpJmespathAboutDescription")}{" "}
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
                                                    <Input
                                                        {...field}
                                                        disabled={loading}
                                                    />
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
                                                        disabled={loading}
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
                                                        disabled={loading}
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
                                                    <Input
                                                        {...field}
                                                        disabled={loading}
                                                    />
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
    );
}
