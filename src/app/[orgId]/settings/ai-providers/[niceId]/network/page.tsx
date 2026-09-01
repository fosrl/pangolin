"use client";

import {
    ProxyResourceTargetsForm,
    type ProxyResourceTargetsFormHandle
} from "@app/app/[orgId]/settings/resources/public/ProxyResourceTargetsForm";
import {
    SettingsContainer,
    SettingsFormCell,
    SettingsFormGrid,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionFooter,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle,
    SettingsSubsectionDescription,
    SettingsSubsectionHeader,
    SettingsSubsectionTitle
} from "@app/components/Settings";
import { StrategySelect } from "@app/components/StrategySelect";
import { SwitchInput } from "@app/components/SwitchInput";
import { HeadersInput } from "@app/components/HeadersInput";
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
import { useAiProviderContext } from "@app/hooks/useAiProviderContext";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import {
    createAiProviderFormSchema,
    showsUpstreamUrlField,
    toAiProviderNetworkPayload,
    type AiProviderFormValues
} from "@app/lib/aiProviderFormSchema";
import { aiProviderQueries } from "@app/lib/queries";
import { zodResolver } from "@hookform/resolvers/zod";
import type {
    AiProviderAuthType,
    AiProviderType
} from "@app/lib/aiProviderDefaults";
import type { CreateOrEditAiProviderResponse } from "@server/routers/aiProvider/types";
import { useQuery } from "@tanstack/react-query";
import type { AxiosResponse } from "axios";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";

export default function AiProviderNetworkPage() {
    const { provider, updateProvider } = useAiProviderContext();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const params = useParams();
    const orgId = params.orgId as string;
    const router = useRouter();
    const t = useTranslations();
    const [saveLoading, setSaveLoading] = useState(false);
    const [headersValid, setHeadersValid] = useState(true);
    const targetsFormRef = useRef<ProxyResourceTargetsFormHandle>(null);

    const formSchema = useMemo(() => createAiProviderFormSchema(t), [t]);

    const form = useForm<AiProviderFormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: provider.name,
            type: provider.type as AiProviderType,
            upstreamUrl: provider.upstreamUrl ?? "",
            apiKey: "",
            authType: (provider.authType as AiProviderAuthType) ?? "bearer",
            routingMode: (provider.routingMode as "url" | "target") ?? "url",
            headers: provider.headers ?? [],
            skipTlsVerification: provider.skipTlsVerification,
            enabled: provider.enabled,
            capabilities: provider.capabilities ?? []
        }
    });

    const providerType = form.watch("type");
    const routingMode = form.watch("routingMode");
    const showUpstream = showsUpstreamUrlField(providerType, routingMode);
    const showRoutingMode = providerType === "custom";
    const isTargetModeSelected = routingMode === "target";
    const isTargetModeSaved =
        provider.type === "custom" && provider.routingMode === "target";
    const showTargetsForm = showRoutingMode && isTargetModeSelected;

    const { data: remoteTargets = [], isLoading: isLoadingTargets } = useQuery({
        ...aiProviderQueries.providerTargets({
            providerId: provider.providerId
        }),
        enabled: isTargetModeSaved
    });

    async function onSubmit(values: AiProviderFormValues) {
        setSaveLoading(true);
        try {
            const res = await api.post<
                AxiosResponse<CreateOrEditAiProviderResponse>
            >(
                `/ai-provider/${provider.providerId}`,
                toAiProviderNetworkPayload({
                    ...values,
                    type: provider.type as AiProviderType
                })
            );
            const updated = res.data.data.provider;
            updateProvider(updated);
            form.reset({
                name: updated.name,
                type: updated.type as AiProviderType,
                upstreamUrl: updated.upstreamUrl ?? "",
                apiKey: "",
                authType: (updated.authType as AiProviderAuthType) ?? "bearer",
                routingMode: (updated.routingMode as "url" | "target") ?? "url",
                headers: updated.headers ?? [],
                skipTlsVerification: updated.skipTlsVerification,
                enabled: updated.enabled,
                capabilities: updated.capabilities ?? []
            });

            if (values.routingMode === "target" && targetsFormRef.current) {
                const targetsSaved = await targetsFormRef.current.save({
                    silent: true
                });
                if (!targetsSaved) {
                    return;
                }
            }

            toast({
                title: t("success"),
                description: t("aiProviderUpdated")
            });
            router.refresh();
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("aiProviderErrorUpdate"),
                description: formatAxiosError(e, t("aiProviderErrorUpdate"))
            });
        } finally {
            setSaveLoading(false);
        }
    }

    return (
        <SettingsContainer>
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("aiProviderNetworkSettings")}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("aiProviderNetworkSettingsDescription")}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>

                <SettingsSectionBody>
                    <SettingsSectionForm variant="half">
                        <Form {...form}>
                            <form
                                onSubmit={form.handleSubmit(onSubmit)}
                                id="ai-provider-network-form"
                            >
                                <SettingsFormGrid>
                                    {showRoutingMode && (
                                        <SettingsFormCell span="full">
                                            <FormField
                                                control={form.control}
                                                name="routingMode"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t(
                                                                "aiProviderRoutingMode"
                                                            )}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <StrategySelect
                                                                cols={2}
                                                                options={[
                                                                    {
                                                                        id: "url",
                                                                        title: t(
                                                                            "aiProviderRoutingModeUrl"
                                                                        ),
                                                                        description:
                                                                            t(
                                                                                "aiProviderRoutingModeUrlDescription"
                                                                            )
                                                                    },
                                                                    {
                                                                        id: "target",
                                                                        title: t(
                                                                            "aiProviderRoutingModeTarget"
                                                                        ),
                                                                        description:
                                                                            t(
                                                                                "aiProviderRoutingModeTargetDescription"
                                                                            )
                                                                    }
                                                                ]}
                                                                value={
                                                                    field.value ??
                                                                    "url"
                                                                }
                                                                onChange={
                                                                    field.onChange
                                                                }
                                                            />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </SettingsFormCell>
                                    )}

                                    <SettingsFormCell span="full">
                                        <FormField
                                            control={form.control}
                                            name="skipTlsVerification"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormControl>
                                                        <SwitchInput
                                                            id="edit-skip-tls"
                                                            label={t(
                                                                "aiProviderSkipTlsVerification"
                                                            )}
                                                            description={t(
                                                                "aiProviderSkipTlsVerificationDescription"
                                                            )}
                                                            checked={
                                                                field.value ??
                                                                false
                                                            }
                                                            onCheckedChange={
                                                                field.onChange
                                                            }
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </SettingsFormCell>

                                    {showUpstream && (
                                        <SettingsFormCell span="half">
                                            <FormField
                                                control={form.control}
                                                name="upstreamUrl"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t(
                                                                "aiProviderUpstreamUrl"
                                                            )}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                autoComplete="off"
                                                                value={
                                                                    field.value ??
                                                                    ""
                                                                }
                                                                onChange={
                                                                    field.onChange
                                                                }
                                                            />
                                                        </FormControl>
                                                        <FormDescription>
                                                            {t(
                                                                "aiProviderUpstreamUrlDescription"
                                                            )}
                                                        </FormDescription>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </SettingsFormCell>
                                    )}

                                    <SettingsFormCell span="full">
                                        <FormField
                                            control={form.control}
                                            name="headers"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t("customHeaders")}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <HeadersInput
                                                            value={field.value}
                                                            onChange={
                                                                field.onChange
                                                            }
                                                            onValidityChange={
                                                                setHeadersValid
                                                            }
                                                            rows={4}
                                                        />
                                                    </FormControl>
                                                    <FormDescription>
                                                        {t(
                                                            "aiProviderCustomHeadersDescription"
                                                        )}
                                                    </FormDescription>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </SettingsFormCell>
                                </SettingsFormGrid>
                            </form>
                        </Form>
                    </SettingsSectionForm>

                    {showTargetsForm &&
                        (!isTargetModeSaved || !isLoadingTargets) && (
                            <div className="mt-6 space-y-4">
                                <SettingsSubsectionHeader>
                                    <SettingsSubsectionTitle>
                                        {t("targets")}
                                    </SettingsSubsectionTitle>
                                    <SettingsSubsectionDescription>
                                        {t("targetsDescription")}
                                    </SettingsSubsectionDescription>
                                </SettingsSubsectionHeader>
                                <ProxyResourceTargetsForm
                                    ref={targetsFormRef}
                                    orgId={orgId}
                                    isHttp
                                    isAiProvider
                                    providerId={provider.providerId}
                                    initialTargets={
                                        isTargetModeSaved ? remoteTargets : []
                                    }
                                    allowedMethods={["http", "https"]}
                                    emptyMessage={t("aiProviderTargetNoOne")}
                                    embedded
                                    hideSaveButton
                                    disableAdvancedMode
                                />
                            </div>
                        )}
                </SettingsSectionBody>
                <SettingsSectionFooter>
                    <Button
                        type="submit"
                        loading={saveLoading}
                        disabled={saveLoading || !headersValid}
                        form="ai-provider-network-form"
                    >
                        {t("saveSettings")}
                    </Button>
                </SettingsSectionFooter>
            </SettingsSection>
        </SettingsContainer>
    );
}
