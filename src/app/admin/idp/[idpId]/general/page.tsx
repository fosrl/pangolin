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
import IdpAutoProvisionUsersDescription from "@app/components/IdpAutoProvisionUsersDescription";
import { SwitchInput } from "@app/components/SwitchInput";
import {
    InfoSection,
    InfoSectionContent,
    InfoSections,
    InfoSectionTitle
} from "@app/components/InfoSection";
import CopyToClipboard from "@app/components/CopyToClipboard";
import IdpTypeBadge from "@app/components/IdpTypeBadge";
import IdpIdentifierChangeDialog from "@app/components/IdpIdentifierChangeDialog";
import { useTranslations } from "next-intl";

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
    const [pendingPayload, setPendingPayload] = useState<Record<
        string,
        unknown
    > | null>(null);

    const redirectUrl = `${env.app.dashboardUrl}/auth/idp/${idpId}/oidc/callback`;
    const t = useTranslations();

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
        autoProvision: z.boolean().default(false)
    });

    const GoogleFormSchema = z.object({
        name: z.string().min(2, { message: t("nameMin", { len: 2 }) }),
        clientId: z.string().min(1, { message: t("idpClientIdRequired") }),
        clientSecret: z
            .string()
            .min(1, { message: t("idpClientSecretRequired") }),
        autoProvision: z.boolean().default(false)
    });

    const AzureFormSchema = z.object({
        name: z.string().min(2, { message: t("nameMin", { len: 2 }) }),
        clientId: z.string().min(1, { message: t("idpClientIdRequired") }),
        clientSecret: z
            .string()
            .min(1, { message: t("idpClientSecretRequired") }),
        tenantId: z.string().min(1, { message: t("idpTenantIdRequired") }),
        autoProvision: z.boolean().default(false)
    });

    type OidcFormValues = z.infer<typeof OidcFormSchema>;
    type GoogleFormValues = z.infer<typeof GoogleFormSchema>;
    type AzureFormValues = z.infer<typeof AzureFormSchema>;
    type GeneralFormValues =
        | OidcFormValues
        | GoogleFormValues
        | AzureFormValues;

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
            autoProvision: true,
            tenantId: ""
        }
    });

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
                            | "oidc"
                            | "google"
                            | "azure") || "oidc";
                    setVariant(idpVariant);
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
                        autoProvision: data.idp.autoProvision
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
            }
        };

        loadIdp();
    }, [idpId]);

    async function onSubmit(data: GeneralFormValues) {
        setLoading(true);

        try {
            const schema = getFormSchema();
            const validationResult = schema.safeParse(data);

            if (!validationResult.success) {
                const errors = validationResult.error.flatten().fieldErrors;
                Object.keys(errors).forEach((key) => {
                    const fieldName = key as keyof GeneralFormValues;
                    const errorMessage =
                        (errors as Record<string, string[] | undefined>)[
                            key
                        ]?.[0] || t("invalidValue");
                    form.setError(fieldName, {
                        type: "manual",
                        message: errorMessage
                    });
                });
                setLoading(false);
                return;
            }

            let payload: Record<string, unknown> = {
                name: data.name,
                clientId: data.clientId,
                clientSecret: data.clientSecret,
                autoProvision: data.autoProvision,
                variant
            };

            if (variant === "oidc") {
                const oidcData = data as OidcFormValues;
                payload = {
                    ...payload,
                    authUrl: oidcData.authUrl,
                    tokenUrl: oidcData.tokenUrl,
                    identifierPath: oidcData.identifierPath,
                    emailPath: oidcData.emailPath ?? "",
                    namePath: oidcData.namePath ?? "",
                    scopes: oidcData.scopes
                };
            } else if (variant === "azure") {
                const azureData = data as AzureFormValues;
                const authUrl = `https://login.microsoftonline.com/${azureData.tenantId}/oauth2/v2.0/authorize`;
                const tokenUrl = `https://login.microsoftonline.com/${azureData.tenantId}/oauth2/v2.0/token`;
                payload = {
                    ...payload,
                    authUrl,
                    tokenUrl,
                    identifierPath: "email",
                    emailPath: "email",
                    namePath: "name",
                    scopes: "openid profile email"
                };
            } else if (variant === "google") {
                payload = {
                    ...payload,
                    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
                    tokenUrl: "https://oauth2.googleapis.com/token",
                    identifierPath: "email",
                    emailPath: "email",
                    namePath: "name",
                    scopes: "openid profile email"
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
        const res = await api.post(`/idp/${idpId}/oidc`, payload);

        if (res.status === 200) {
            if (typeof payload.identifierPath === "string") {
                setOriginalIdentifierPath(payload.identifierPath);
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
                                </form>
                            </Form>
                        </SettingsSectionForm>
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
                        <Form {...form}>
                            <form
                                onSubmit={form.handleSubmit(onSubmit)}
                                className="space-y-4"
                                id="general-settings-form"
                            >
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
                                <div className="flex flex-col gap-2">
                                    {form.watch("autoProvision") && (
                                        <FormDescription>
                                            {t.rich(
                                                "idpAdminAutoProvisionPoliciesTabHint",
                                                {
                                                    policiesTabLink: (
                                                        chunks
                                                    ) => (
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
                                </div>
                            </form>
                        </Form>
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
                    {t("saveGeneralSettings")}
                </Button>
            </div>
        </>
    );
}
