"use client";

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
import {
    AiProviderAttachments,
    type AiProviderAttachmentValue
} from "@app/components/AiProviderAttachments";
import DomainPicker from "@app/components/DomainPicker";
import { SwitchInput } from "@app/components/SwitchInput";
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
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useSaveSiteResource } from "@app/hooks/useSaveSiteResource";
import { useSiteResourceContext } from "@app/hooks/useSiteResourceContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { resourceQueries } from "@app/lib/queries";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

export default function PrivateResourceInferencePage() {
    const t = useTranslations();
    const router = useRouter();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const queryClient = useQueryClient();
    const { siteResource } = useSiteResourceContext();
    const { save } = useSaveSiteResource();

    useEffect(() => {
        if (siteResource.mode !== "inference") {
            router.replace(
                `/${siteResource.orgId}/settings/resources/private/${siteResource.niceId}/general`
            );
        }
    }, [router, siteResource.mode, siteResource.niceId, siteResource.orgId]);

    const formSchema = useMemo(
        () =>
            z.object({
                providers: z.array(
                    z.object({
                        providerId: z.number().int().positive(),
                        niceId: z.string(),
                        name: z.string(),
                        accessMode: z.enum(["inherit", "select"]),
                        enabled: z.boolean(),
                        selectedModelIds: z.array(z.number().int().positive())
                    })
                ),
                httpConfigSubdomain: z.string().nullish(),
                httpConfigDomainId: z.string().nullish(),
                httpConfigFullDomain: z.string().nullish(),
                ssl: z.boolean().optional()
            }),
        []
    );
    type FormValues = z.infer<typeof formSchema>;

    const attachedQuery = useQuery({
        ...resourceQueries.siteResourceAiProviders({
            siteResourceId: siteResource.id
        }),
        enabled: siteResource.mode === "inference"
    });

    const modelsQuery = useQuery({
        ...resourceQueries.siteResourceAiModels({
            siteResourceId: siteResource.id
        }),
        enabled: siteResource.mode === "inference"
    });

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            providers: [],
            httpConfigSubdomain: siteResource.subdomain ?? null,
            httpConfigDomainId: siteResource.domainId ?? null,
            httpConfigFullDomain: siteResource.fullDomain ?? null,
            ssl: siteResource.ssl ?? false
        }
    });

    const httpConfigSubdomain = form.watch("httpConfigSubdomain");
    const httpConfigDomainId = form.watch("httpConfigDomainId");
    const httpConfigFullDomain = form.watch("httpConfigFullDomain");

    useEffect(() => {
        if (!attachedQuery.data) return;
        const hasSelect = attachedQuery.data.some(
            (provider) => provider.accessMode === "select"
        );
        if (hasSelect && modelsQuery.isLoading) return;

        const modelsByProvider = new Map<number, number[]>();
        for (const model of modelsQuery.data ?? []) {
            if (model.listType !== "allow") continue;
            const existing = modelsByProvider.get(model.providerId) ?? [];
            existing.push(model.modelId);
            modelsByProvider.set(model.providerId, existing);
        }

        form.setValue(
            "providers",
            attachedQuery.data.map((provider) => ({
                providerId: provider.providerId,
                niceId: provider.niceId,
                name: provider.name,
                accessMode: provider.accessMode,
                enabled: provider.enabled,
                selectedModelIds:
                    provider.accessMode === "select"
                        ? (modelsByProvider.get(provider.providerId) ?? [])
                        : []
            }))
        );
    }, [attachedQuery.data, modelsQuery.data, modelsQuery.isLoading, form]);

    const [, formAction, saveLoading] = useActionState(async () => {
        const isValid = await form.trigger();
        if (!isValid) return;

        const data = form.getValues();
        try {
            await save({
                mode: "inference",
                httpConfigSubdomain: data.httpConfigSubdomain,
                httpConfigDomainId: data.httpConfigDomainId,
                httpConfigFullDomain: data.httpConfigFullDomain,
                ssl: data.ssl
            });

            await api.post(`/site-resource/${siteResource.id}/ai-providers`, {
                providers: data.providers.map((provider) => ({
                    providerId: provider.providerId,
                    accessMode: provider.accessMode,
                    enabled: provider.enabled
                }))
            });

            const selectProviders = data.providers.filter(
                (provider) => provider.accessMode === "select"
            );
            if (selectProviders.length > 0) {
                await api.post(`/site-resource/${siteResource.id}/ai-models`, {
                    models: selectProviders.flatMap((provider) =>
                        provider.selectedModelIds.map((modelId) => ({
                            modelId,
                            listType: "allow" as const
                        }))
                    )
                });
            }

            await queryClient.invalidateQueries(
                resourceQueries.siteResourceAiProviders({
                    siteResourceId: siteResource.id
                })
            );
            await queryClient.invalidateQueries(
                resourceQueries.siteResourceAiModels({
                    siteResourceId: siteResource.id
                })
            );

            toast({
                title: t("success"),
                description: t("aiResourceProvidersUpdated")
            });
        } catch (error) {
            toast({
                variant: "destructive",
                title: t("aiResourceProvidersErrorUpdate"),
                description: formatAxiosError(
                    error,
                    t("aiResourceProvidersErrorUpdate")
                )
            });
        }
    }, null);

    if (siteResource.mode !== "inference") {
        return null;
    }

    const providersLoading =
        attachedQuery.isLoading ||
        (attachedQuery.data?.some((p) => p.accessMode === "select") &&
            modelsQuery.isLoading);

    return (
        <SettingsContainer>
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("aiResourceProviders")}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("aiResourceProvidersDescription")}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>

                <SettingsSectionBody>
                    <SettingsSectionForm variant="half">
                        <Form {...form}>
                            <form
                                action={formAction}
                                id="private-resource-providers-form"
                            >
                                <SettingsFormGrid>
                                    <SettingsFormCell span="full">
                                        <FormField
                                            control={form.control}
                                            name="providers"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t(
                                                            "aiResourceProviders"
                                                        )}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <AiProviderAttachments
                                                            orgId={
                                                                siteResource.orgId
                                                            }
                                                            value={
                                                                field.value as AiProviderAttachmentValue[]
                                                            }
                                                            disabled={
                                                                providersLoading
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

                                    <SettingsFormCell span="full">
                                        <SettingsSubsectionHeader>
                                            <SettingsSubsectionTitle>
                                                {t(
                                                    "aiResourceDomainConfiguration"
                                                )}
                                            </SettingsSubsectionTitle>
                                            <SettingsSubsectionDescription>
                                                {t(
                                                    "aiResourceDomainConfigurationDescription"
                                                )}
                                            </SettingsSubsectionDescription>
                                        </SettingsSubsectionHeader>
                                    </SettingsFormCell>
                                    <SettingsFormCell span="full">
                                        <DomainPicker
                                            key={`inference-domain-${siteResource.id}`}
                                            orgId={siteResource.orgId}
                                            cols={2}
                                            hideFreeDomain
                                            defaultSubdomain={
                                                httpConfigSubdomain ?? undefined
                                            }
                                            defaultDomainId={
                                                httpConfigDomainId ?? undefined
                                            }
                                            defaultFullDomain={
                                                httpConfigFullDomain ??
                                                undefined
                                            }
                                            onDomainChange={(res) => {
                                                if (res === null) {
                                                    form.setValue(
                                                        "httpConfigSubdomain",
                                                        null
                                                    );
                                                    form.setValue(
                                                        "httpConfigDomainId",
                                                        null
                                                    );
                                                    form.setValue(
                                                        "httpConfigFullDomain",
                                                        null
                                                    );
                                                    return;
                                                }
                                                form.setValue(
                                                    "httpConfigSubdomain",
                                                    res.subdomain ?? null
                                                );
                                                form.setValue(
                                                    "httpConfigDomainId",
                                                    res.domainId
                                                );
                                                form.setValue(
                                                    "httpConfigFullDomain",
                                                    res.fullDomain
                                                );
                                            }}
                                        />
                                    </SettingsFormCell>
                                    <SettingsFormCell span="half">
                                        <FormField
                                            control={form.control}
                                            name="ssl"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormControl>
                                                        <SwitchInput
                                                            id="private-resource-inference-ssl"
                                                            label={t(
                                                                "editInternalResourceDialogEnableSsl"
                                                            )}
                                                            description={t(
                                                                "editInternalResourceDialogEnableSslDescription"
                                                            )}
                                                            checked={
                                                                !!field.value
                                                            }
                                                            onCheckedChange={
                                                                field.onChange
                                                            }
                                                        />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    </SettingsFormCell>
                                </SettingsFormGrid>
                            </form>
                        </Form>
                    </SettingsSectionForm>
                </SettingsSectionBody>

                <SettingsSectionFooter>
                    <Button
                        type="submit"
                        form="private-resource-providers-form"
                        loading={saveLoading}
                        disabled={providersLoading || saveLoading}
                    >
                        {t("saveSettings")}
                    </Button>
                </SettingsSectionFooter>
            </SettingsSection>
        </SettingsContainer>
    );
}
