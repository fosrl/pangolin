"use client";

import CopyToClipboard from "@app/components/CopyToClipboard";
import {
    InfoSection,
    InfoSectionContent,
    InfoSections,
    InfoSectionTitle
} from "@app/components/InfoSection";
import {
    SettingsContainer,
    SettingsFormCell,
    SettingsFormGrid,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import HeaderTitle from "@app/components/SettingsSectionTitle";
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
import { zodResolver } from "@hookform/resolvers/zod";
import {
    CreateClientBody,
    CreateClientResponse,
    PickClientDefaultsResponse
} from "@server/routers/client";
import { AxiosResponse } from "axios";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { OlmInstallCommands } from "@app/components/olm-install-commands";
import { useTranslations } from "next-intl";

type ClientType = "olm";

interface TunnelTypeOption {
    id: ClientType;
    title: string;
    description: string;
    disabled?: boolean;
}

export default function Page() {
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const { orgId } = useParams();
    const router = useRouter();
    const t = useTranslations();

    const createClientFormSchema = z.object({
        name: z
            .string()
            .min(2, { message: t("nameMin", { len: 2 }) })
            .max(30, { message: t("nameMax", { len: 30 }) }),
        method: z.enum(["olm"]),
        subnet: z.union([z.ipv4(), z.ipv6()]).refine((val) => val.length > 0, {
            message: t("subnetRequired")
        })
    });

    type CreateClientFormValues = z.infer<typeof createClientFormSchema>;

    const [tunnelTypes, setTunnelTypes] = useState<
        ReadonlyArray<TunnelTypeOption>
    >([
        {
            id: "olm",
            title: t("olmTunnel"),
            description: t("olmTunnelDescription"),
            disabled: true
        }
    ]);

    const [loadingPage, setLoadingPage] = useState(true);

    const [olmId, setOlmId] = useState("");
    const [olmSecret, setOlmSecret] = useState("");
    const [olmVersion, setOlmVersion] = useState("latest");

    const [createLoading, setCreateLoading] = useState(false);
    const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

    const [clientDefaults, setClientDefaults] =
        useState<PickClientDefaultsResponse | null>(null);

    const form = useForm<CreateClientFormValues>({
        resolver: zodResolver(createClientFormSchema),
        defaultValues: {
            name: "",
            method: "olm",
            subnet: ""
        }
    });

    async function onSubmit(data: CreateClientFormValues) {
        setCreateLoading(true);

        if (!clientDefaults) {
            toast({
                variant: "destructive",
                title: t("errorCreatingClient"),
                description: t("clientDefaultsNotFound")
            });
            setCreateLoading(false);
            return;
        }

        const payload: CreateClientBody = {
            name: data.name,
            type: data.method as "olm",
            olmId: clientDefaults.olmId,
            secret: clientDefaults.olmSecret,
            subnet: data.subnet
        };

        const res = await api
            .put<
                AxiosResponse<CreateClientResponse>
            >(`/org/${orgId}/client`, payload)
            .catch((e) => {
                toast({
                    variant: "destructive",
                    title: t("errorCreatingClient"),
                    description: formatAxiosError(e)
                });
            });

        if (res && res.status === 201) {
            const data = res.data.data;
            router.push(`/${orgId}/settings/clients/machine/${data.niceId}`);
        }

        setCreateLoading(false);
    }

    useEffect(() => {
        const load = async () => {
            setLoadingPage(true);

            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000);

                const response = await fetch(
                    `https://api.github.com/repos/fosrl/olm/releases/latest`,
                    { signal: controller.signal }
                );

                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(
                        t("olmErrorFetchReleases", {
                            err: response.statusText
                        })
                    );
                }
                const data = await response.json();
                const latestVersion = data.tag_name;
                setOlmVersion(latestVersion);
            } catch (error) {
                if (error instanceof Error && error.name === "AbortError") {
                    console.error(t("olmErrorFetchTimeout"));
                } else {
                    console.error(
                        t("olmErrorFetchLatest", {
                            err:
                                error instanceof Error
                                    ? error.message
                                    : String(error)
                        })
                    );
                }
            }

            await api
                .get(`/org/${orgId}/pick-client-defaults`)
                .catch((e) => {
                    form.setValue("method", "olm");
                })
                .then((res) => {
                    if (res && res.status === 200) {
                        const data = res.data.data;

                        setClientDefaults(data);

                        const olmId = data.olmId;
                        const olmSecret = data.olmSecret;

                        setOlmId(olmId);
                        setOlmSecret(olmSecret);

                        if (data.subnet) {
                            form.setValue("subnet", data.subnet);
                        }

                        setTunnelTypes((prev: any) => {
                            return prev.map((item: any) => {
                                return { ...item, disabled: false };
                            });
                        });
                    }
                });

            setLoadingPage(false);
        };

        load();
    }, []);

    return (
        <>
            <div className="flex justify-between">
                <HeaderTitle
                    title={t("createClient")}
                    description={t("createClientDescription")}
                />
                <Button
                    variant="outline"
                    onClick={() => {
                        router.push(`/${orgId}/settings/clients`);
                    }}
                >
                    {t("seeAllClients")}
                </Button>
            </div>

            {!loadingPage && (
                <div>
                    <SettingsContainer>
                        <SettingsSection>
                            <SettingsSectionHeader>
                                <SettingsSectionTitle>
                                    {t("clientInformation")}
                                </SettingsSectionTitle>
                            </SettingsSectionHeader>
                            <SettingsSectionBody>
                                <SettingsSectionForm variant="half">
                                    <Form {...form}>
                                        <form
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault(); // block default enter refresh
                                                }
                                            }}
                                            id="create-client-form"
                                        >
                                            <SettingsFormGrid>
                                                <SettingsFormCell span="half">
                                                    <FormField
                                                        control={form.control}
                                                        name="name"
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel>
                                                                    {t("name")}
                                                                </FormLabel>
                                                                <FormControl>
                                                                    <Input
                                                                        autoComplete="off"
                                                                        {...field}
                                                                    />
                                                                </FormControl>
                                                                <FormMessage />
                                                                <FormDescription>
                                                                    {t(
                                                                        "clientNameDescription"
                                                                    )}
                                                                </FormDescription>
                                                            </FormItem>
                                                        )}
                                                    />
                                                </SettingsFormCell>
                                                <SettingsFormCell span="full">
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() =>
                                                            setShowAdvancedSettings(
                                                                !showAdvancedSettings
                                                            )
                                                        }
                                                        className="flex items-center gap-2 -ml-3"
                                                    >
                                                        {showAdvancedSettings ? (
                                                            <ChevronUp className="h-4 w-4" />
                                                        ) : (
                                                            <ChevronDown className="h-4 w-4" />
                                                        )}
                                                        {t("advancedSettings")}
                                                    </Button>
                                                </SettingsFormCell>
                                                {showAdvancedSettings && (
                                                    <SettingsFormCell span="half">
                                                        <FormField
                                                            control={
                                                                form.control
                                                            }
                                                            name="subnet"
                                                            render={({
                                                                field
                                                            }) => (
                                                                <FormItem>
                                                                    <FormLabel>
                                                                        {t(
                                                                            "clientAddress"
                                                                        )}
                                                                    </FormLabel>
                                                                    <FormControl>
                                                                        <Input
                                                                            autoComplete="off"
                                                                            placeholder={t(
                                                                                "subnetPlaceholder"
                                                                            )}
                                                                            {...field}
                                                                        />
                                                                    </FormControl>
                                                                    <FormMessage />
                                                                    <FormDescription>
                                                                        {t(
                                                                            "addressDescription"
                                                                        )}
                                                                    </FormDescription>
                                                                </FormItem>
                                                            )}
                                                        />
                                                    </SettingsFormCell>
                                                )}
                                            </SettingsFormGrid>
                                        </form>
                                    </Form>
                                </SettingsSectionForm>
                            </SettingsSectionBody>
                        </SettingsSection>

                        {form.watch("method") === "olm" && (
                            <>
                                <SettingsSection>
                                    <SettingsSectionHeader>
                                        <SettingsSectionTitle>
                                            {t("clientOlmCredentials")}
                                        </SettingsSectionTitle>
                                        <SettingsSectionDescription>
                                            {t(
                                                "clientOlmCredentialsDescription"
                                            )}
                                        </SettingsSectionDescription>
                                    </SettingsSectionHeader>
                                    <SettingsSectionBody>
                                        <InfoSections cols={3}>
                                            <InfoSection>
                                                <InfoSectionTitle>
                                                    {t("olmEndpoint")}
                                                </InfoSectionTitle>
                                                <InfoSectionContent>
                                                    <CopyToClipboard
                                                        text={
                                                            env.app.dashboardUrl
                                                        }
                                                    />
                                                </InfoSectionContent>
                                            </InfoSection>
                                            <InfoSection>
                                                <InfoSectionTitle>
                                                    {t("olmId")}
                                                </InfoSectionTitle>
                                                <InfoSectionContent>
                                                    <CopyToClipboard
                                                        text={olmId}
                                                    />
                                                </InfoSectionContent>
                                            </InfoSection>
                                            <InfoSection>
                                                <InfoSectionTitle>
                                                    {t("olmSecretKey")}
                                                </InfoSectionTitle>
                                                <InfoSectionContent>
                                                    <CopyToClipboard
                                                        text={olmSecret}
                                                    />
                                                </InfoSectionContent>
                                            </InfoSection>
                                        </InfoSections>
                                    </SettingsSectionBody>
                                </SettingsSection>
                                <OlmInstallCommands
                                    id={olmId}
                                    endpoint={env.app.dashboardUrl}
                                    secret={olmSecret}
                                    version={olmVersion}
                                />
                            </>
                        )}
                    </SettingsContainer>

                    <div className="flex justify-end space-x-2 mt-8">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                                router.push(`/${orgId}/settings/clients`);
                            }}
                        >
                            {t("cancel")}
                        </Button>
                        <Button
                            type="button"
                            loading={createLoading}
                            disabled={createLoading}
                            onClick={() => {
                                form.handleSubmit(onSubmit)();
                            }}
                        >
                            {t("createClient")}
                        </Button>
                    </div>
                </div>
            )}
        </>
    );
}
