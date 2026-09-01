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
import { AiProviderCapabilitiesSelect } from "@app/components/AiProviderCapabilitiesSelect";
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
import { Input } from "@app/components/ui/input";
import { useAiProviderContext } from "@app/hooks/useAiProviderContext";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { zodResolver } from "@hookform/resolvers/zod";
import { AI_CAPABILITIES, type AiCapability } from "@app/lib/aiCapabilities";
import type { CreateOrEditAiProviderResponse } from "@server/routers/aiProvider/types";
import type { AxiosResponse } from "axios";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

export default function AiProviderGeneralPage() {
    const { provider, updateProvider } = useAiProviderContext();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const router = useRouter();
    const t = useTranslations();
    const [saveLoading, setSaveLoading] = useState(false);

    const generalSchema = useMemo(
        () =>
            z
                .object({
                    name: z
                        .string()
                        .trim()
                        .min(1, { message: t("nameRequired") }),
                    niceId: z.string().min(1).max(255).optional(),
                    enabled: z.boolean(),
                    capabilities: z.array(z.enum(AI_CAPABILITIES)).optional()
                })
                .superRefine((data, ctx) => {
                    if (!data.capabilities || data.capabilities.length === 0) {
                        ctx.addIssue({
                            code: "custom",
                            message: t("aiProviderErrorCapabilitiesRequired"),
                            path: ["capabilities"]
                        });
                    }
                }),
        [t]
    );

    type GeneralFormValues = z.infer<typeof generalSchema>;

    const form = useForm<GeneralFormValues>({
        resolver: zodResolver(generalSchema),
        defaultValues: {
            name: provider.name,
            niceId: provider.niceId,
            enabled: provider.enabled,
            capabilities: provider.capabilities ?? []
        }
    });

    async function onSubmit(values: GeneralFormValues) {
        setSaveLoading(true);
        try {
            const body: {
                name: string;
                niceId?: string;
                enabled: boolean;
                capabilities?: AiCapability[];
            } = {
                name: values.name.trim(),
                niceId: values.niceId,
                enabled: values.enabled,
                capabilities: values.capabilities ?? []
            };

            const res = await api.post<
                AxiosResponse<CreateOrEditAiProviderResponse>
            >(`/ai-provider/${provider.providerId}`, body);
            const updated = res.data.data.provider;
            updateProvider(updated);
            form.reset({
                name: updated.name,
                niceId: updated.niceId,
                enabled: updated.enabled,
                capabilities: updated.capabilities ?? []
            });
            toast({
                title: t("success"),
                description: t("aiProviderUpdated")
            });

            if (values.niceId && values.niceId !== provider.niceId) {
                router.replace(
                    `/${provider.orgId}/settings/ai-providers/${values.niceId}/general`
                );
            }

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
                        {t("aiProviderGeneral")}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("aiProviderGeneralDescription")}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>

                <SettingsSectionBody>
                    <SettingsSectionForm variant="half">
                        <Form {...form}>
                            <form
                                onSubmit={form.handleSubmit(onSubmit)}
                                id="ai-provider-general-form"
                            >
                                <SettingsFormGrid>
                                    <SettingsFormCell span="full">
                                        <FormField
                                            control={form.control}
                                            name="enabled"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormControl>
                                                        <SwitchInput
                                                            id="edit-enabled"
                                                            label={t(
                                                                "aiProviderEnabled"
                                                            )}
                                                            description={t(
                                                                "aiProviderEnabledDescription"
                                                            )}
                                                            checked={
                                                                field.value
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
                                                </FormItem>
                                            )}
                                        />
                                    </SettingsFormCell>

                                    <SettingsFormCell span="half">
                                        <FormField
                                            control={form.control}
                                            name="niceId"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t("identifier")}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            {...field}
                                                            placeholder={t(
                                                                "enterIdentifier"
                                                            )}
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </SettingsFormCell>

                                    <SettingsFormCell span="full">
                                        <FormField
                                            control={form.control}
                                            name="capabilities"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t(
                                                            "aiProviderCapabilities"
                                                        )}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <AiProviderCapabilitiesSelect
                                                            value={
                                                                field.value ??
                                                                []
                                                            }
                                                            onChange={
                                                                field.onChange
                                                            }
                                                        />
                                                    </FormControl>
                                                    <FormDescription>
                                                        {t(
                                                            "aiProviderCapabilitiesDescription"
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
                </SettingsSectionBody>
                <SettingsSectionFooter>
                    <Button
                        type="submit"
                        loading={saveLoading}
                        disabled={saveLoading}
                        form="ai-provider-general-form"
                    >
                        {t("saveSettings")}
                    </Button>
                </SettingsSectionFooter>
            </SettingsSection>
        </SettingsContainer>
    );
}
