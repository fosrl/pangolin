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
    SettingsSectionTitle
} from "@app/components/Settings";
import {
    AiProviderAttachments,
    type AiProviderAttachmentValue
} from "@app/components/AiProviderAttachments";
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
import { useResourceContext } from "@app/hooks/useResourceContext";
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

export default function PublicResourceInferencePage() {
    const t = useTranslations();
    const router = useRouter();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const queryClient = useQueryClient();
    const { resource } = useResourceContext();

    useEffect(() => {
        if (resource.mode !== "inference") {
            router.replace(
                `/${resource.orgId}/settings/resources/public/${resource.niceId}/general`
            );
        }
    }, [router, resource.mode, resource.niceId, resource.orgId]);

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
                )
            }),
        []
    );
    type FormValues = z.infer<typeof formSchema>;

    const attachedQuery = useQuery({
        ...resourceQueries.resourceAiProviders({
            resourceId: resource.resourceId
        }),
        enabled: resource.mode === "inference"
    });

    const modelsQuery = useQuery({
        ...resourceQueries.resourceAiModels({
            resourceId: resource.resourceId
        }),
        enabled: resource.mode === "inference"
    });

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            providers: []
        }
    });

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

        form.reset({
            providers: attachedQuery.data.map((provider) => ({
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
        });
    }, [
        attachedQuery.data,
        modelsQuery.data,
        modelsQuery.isLoading,
        form
    ]);

    const [, formAction, saveLoading] = useActionState(async () => {
        const isValid = await form.trigger();
        if (!isValid) return;

        const data = form.getValues();
        try {
            await api.post(`/resource/${resource.resourceId}/ai-providers`, {
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
                await api.post(`/resource/${resource.resourceId}/ai-models`, {
                    models: selectProviders.flatMap((provider) =>
                        provider.selectedModelIds.map((modelId) => ({
                            modelId,
                            listType: "allow" as const
                        }))
                    )
                });
            }

            await queryClient.invalidateQueries(
                resourceQueries.resourceAiProviders({
                    resourceId: resource.resourceId
                })
            );
            await queryClient.invalidateQueries(
                resourceQueries.resourceAiModels({
                    resourceId: resource.resourceId
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

    if (resource.mode !== "inference") {
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
                                id="public-resource-providers-form"
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
                                                                resource.orgId
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
                                </SettingsFormGrid>
                            </form>
                        </Form>
                    </SettingsSectionForm>
                </SettingsSectionBody>

                <SettingsSectionFooter>
                    <Button
                        type="submit"
                        form="public-resource-providers-form"
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
