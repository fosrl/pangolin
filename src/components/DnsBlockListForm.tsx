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
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
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
import { Textarea } from "@app/components/ui/textarea";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { zodResolver } from "@hookform/resolvers/zod";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import type { DnsBlockListDetail } from "@server/routers/dnsBlocking/types";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

type DnsBlockListFormProps = {
    orgId: string;
    // Present when editing an existing list.
    list?: DnsBlockListDetail;
};

export default function DnsBlockListForm({
    orgId,
    list
}: DnsBlockListFormProps) {
    const t = useTranslations();
    const router = useRouter();
    const api = createApiClient(useEnvContext());
    const { isPaidUser } = usePaidStatus();
    const [loading, setLoading] = useState(false);
    const disabled = !isPaidUser(tierMatrix.dnsBlocking);

    const schema = useMemo(
        () =>
            z.object({
                name: z
                    .string()
                    .trim()
                    .min(1, { message: t("nameRequired") })
                    .max(255),
                description: z.string().trim().max(1000),
                domains: z.string()
            }),
        [t]
    );

    const form = useForm<z.infer<typeof schema>>({
        resolver: zodResolver(schema),
        defaultValues: {
            name: list?.name ?? "",
            description: list?.description ?? "",
            domains: list?.domains ?? ""
        }
    });

    async function onSubmit(values: z.infer<typeof schema>) {
        setLoading(true);
        try {
            const body = {
                name: values.name,
                description: values.description || null,
                domains: values.domains
            };
            if (list) {
                await api.post(
                    `/org/${orgId}/dns-block-list/${list.dnsBlockListId}`,
                    body
                );
                toast({
                    title: t("success"),
                    description: t("dnsBlockListSaved")
                });
                router.refresh();
            } else {
                await api.put(`/org/${orgId}/dns-block-list`, body);
                toast({
                    title: t("success"),
                    description: t("dnsBlockListCreated")
                });
                router.push(`/${orgId}/settings/dns-blocking`);
            }
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("dnsBlockListErrorSave"),
                description: formatAxiosError(e)
            });
        } finally {
            setLoading(false);
        }
    }

    return (
        <SettingsContainer>
            <PaidFeaturesAlert tiers={tierMatrix.dnsBlocking} />
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {list
                            ? t("dnsBlockListEditTitle")
                            : t("dnsBlockListCreateTitle")}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {list
                            ? t("dnsBlockListEditDescription")
                            : t("dnsBlockListCreateDescription")}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>
                <SettingsSectionBody>
                    <SettingsSectionForm>
                        <Form {...form}>
                            <form
                                id="dns-block-list-form"
                                onSubmit={form.handleSubmit(onSubmit)}
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
                                                            disabled={disabled}
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
                                            name="description"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t("description")}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            autoComplete="off"
                                                            disabled={disabled}
                                                            {...field}
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
                                            name="domains"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t(
                                                            "dnsBlockListDomains"
                                                        )}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Textarea
                                                            rows={14}
                                                            className="font-mono text-sm"
                                                            spellCheck={false}
                                                            placeholder={t(
                                                                "dnsBlockListDomainsPlaceholder"
                                                            )}
                                                            disabled={disabled}
                                                            {...field}
                                                        />
                                                    </FormControl>
                                                    <FormDescription>
                                                        {t(
                                                            "dnsBlockListDomainsDescription"
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
                        form="dns-block-list-form"
                        loading={loading}
                        disabled={loading || disabled}
                    >
                        {t("saveSettings")}
                    </Button>
                </SettingsSectionFooter>
            </SettingsSection>
        </SettingsContainer>
    );
}
