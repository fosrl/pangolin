"use client";

import {
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

import { useEnvContext } from "@app/hooks/useEnvContext";
import { useOrgContext } from "@app/hooks/useOrgContext";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";

import z from "zod";

import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { type ResourcePolicy } from "@server/db";
import type { AxiosResponse } from "axios";
import { useRouter } from "next/navigation";

import { Button } from "@app/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { Input } from "@app/components/ui/input";

import { useResourcePolicyContext } from "@app/providers/ResourcePolicyProvider";
import { useActionState } from "react";
import { useForm } from "react-hook-form";

// ─── PolicyNameSection ──────────────────────────────────────────────────

const PolicyNameFormSchema = z.object({
    name: z.string(),
    niceId: z.string().min(1).max(255).optional()
});

export function EditPolicyNameSectionForm({
    readonly
}: {
    readonly?: boolean;
}) {
    const t = useTranslations();
    const api = createApiClient(useEnvContext());
    const router = useRouter();
    const { org } = useOrgContext();

    const { policy, updatePolicy } = useResourcePolicyContext();

    const form = useForm({
        resolver: zodResolver(PolicyNameFormSchema),
        defaultValues: {
            name: policy.name,
            niceId: policy.niceId || ""
        }
    });

    const [, formAction, isSubmitting] = useActionState(onSubmit, null);

    async function onSubmit() {
        if (readonly) return;
        const isValid = await form.trigger();

        if (!isValid) return;

        const payload = form.getValues();

        try {
            const res = await api
                .put<AxiosResponse<ResourcePolicy>>(
                    `/resource-policy/${policy.resourcePolicyId}`,
                    {
                        name: payload.name,
                        niceId: payload.niceId
                    }
                )
                .catch((e) => {
                    toast({
                        variant: "destructive",
                        title: t("policyErrorUpdate"),
                        description: formatAxiosError(
                            e,
                            t("policyErrorUpdateDescription")
                        )
                    });
                });

            if (res && res.status === 200) {
                updatePolicy({
                    name: payload.name,
                    niceId: payload.niceId
                });

                toast({
                    title: t("success"),
                    description: t("policyUpdatedSuccess")
                });

                if (payload.niceId && payload.niceId !== policy.niceId) {
                    router.replace(
                        `/${org.org.orgId}/settings/policies/resources/public/${payload.niceId}/general`
                    );
                }

                router.refresh();
            }
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("policyErrorUpdate"),
                description: t("policyErrorUpdateMessageDescription")
            });
        }
    }

    return (
        <Form {...form}>
            <form action={formAction}>
                <SettingsSection>
                    <SettingsSectionHeader>
                        <SettingsSectionTitle>
                            {t("resourcePolicyName")}
                        </SettingsSectionTitle>
                        <SettingsSectionDescription>
                            {t("resourcePolicyNameDescription")}
                        </SettingsSectionDescription>
                    </SettingsSectionHeader>
                    <SettingsSectionBody>
                        <SettingsSectionForm variant="half">
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
                                                        {...field}
                                                        disabled={readonly}
                                                        placeholder={t(
                                                            "resourcePolicyNamePlaceholder"
                                                        )}
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
                                                        disabled={readonly}
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
                            </SettingsFormGrid>
                        </SettingsSectionForm>
                    </SettingsSectionBody>

                    <SettingsSectionFooter>
                        <Button
                            type="submit"
                            loading={isSubmitting}
                            disabled={readonly || isSubmitting}
                        >
                            {t("saveSettings")}
                        </Button>
                    </SettingsSectionFooter>
                </SettingsSection>
            </form>
        </Form>
    );
}
