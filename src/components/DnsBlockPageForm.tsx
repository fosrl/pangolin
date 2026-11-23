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
import { useOrgContext } from "@app/hooks/useOrgContext";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { fillBlockPageText } from "@app/lib/dnsBlockPage";
import { zodResolver } from "@hookform/resolvers/zod";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import {
    DNS_BLOCK_PAGE_CONTACT_MAX,
    DNS_BLOCK_PAGE_MESSAGE_MAX,
    DNS_BLOCK_PAGE_TITLE_MAX,
    type DnsBlockPageValues
} from "@server/routers/dnsBlocking/types";
import { ShieldBan } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

type DnsBlockPageFormProps = {
    orgId: string;
    values: DnsBlockPageValues | null;
};

const PREVIEW_DOMAIN = "example.com";

export default function DnsBlockPageForm({
    orgId,
    values
}: DnsBlockPageFormProps) {
    const t = useTranslations();
    const router = useRouter();
    const api = createApiClient(useEnvContext());
    const { org } = useOrgContext();
    const { isPaidUser } = usePaidStatus();
    const [loading, setLoading] = useState(false);
    const disabled = !isPaidUser(tierMatrix.dnsBlocking);

    const schema = useMemo(
        () =>
            z.object({
                title: z.string().trim().max(DNS_BLOCK_PAGE_TITLE_MAX),
                message: z.string().trim().max(DNS_BLOCK_PAGE_MESSAGE_MAX),
                contact: z.string().trim().max(DNS_BLOCK_PAGE_CONTACT_MAX)
            }),
        []
    );

    const form = useForm<z.infer<typeof schema>>({
        resolver: zodResolver(schema),
        defaultValues: {
            title: values?.title ?? "",
            message: values?.message ?? "",
            contact: values?.contact ?? ""
        }
    });

    // The default wording, with the placeholders left in so admins can see
    // where they go.
    const defaultTitle = t("dnsBlockPageDefaultTitle");
    const defaultMessage = t("dnsBlockPageDefaultMessage", {
        domain: "{{domain}}",
        orgName: "{{orgName}}"
    });

    const [title, message, contact] = useWatch({
        control: form.control,
        name: ["title", "message", "contact"]
    });
    const vars = { domain: PREVIEW_DOMAIN, orgName: org.org.name };

    async function onSubmit(data: z.infer<typeof schema>) {
        setLoading(true);
        try {
            await api.post(`/org/${orgId}/dns-block-page`, {
                title: data.title || null,
                message: data.message || null,
                contact: data.contact || null
            });
            toast({
                title: t("success"),
                description: t("dnsBlockPageSaved")
            });
            router.refresh();
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("dnsBlockPageErrorSave"),
                description: formatAxiosError(e)
            });
        } finally {
            setLoading(false);
        }
    }

    return (
        <SettingsContainer>
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("dnsBlockPageTitle")}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("dnsBlockPageDescription")}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>
                <SettingsSectionBody>
                    <SettingsSectionForm variant="half">
                        <Form {...form}>
                            <form
                                id="dns-block-page-form"
                                onSubmit={form.handleSubmit(onSubmit)}
                            >
                                <SettingsFormGrid>
                                    <SettingsFormCell span="full">
                                        <PaidFeaturesAlert
                                            tiers={tierMatrix.dnsBlocking}
                                        />
                                    </SettingsFormCell>
                                    <SettingsFormCell span="full">
                                        <FormField
                                            control={form.control}
                                            name="title"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t(
                                                            "dnsBlockPageFieldTitle"
                                                        )}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            autoComplete="off"
                                                            placeholder={
                                                                defaultTitle
                                                            }
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
                                            name="message"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t(
                                                            "dnsBlockPageFieldMessage"
                                                        )}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Textarea
                                                            rows={4}
                                                            placeholder={
                                                                defaultMessage
                                                            }
                                                            disabled={disabled}
                                                            {...field}
                                                        />
                                                    </FormControl>
                                                    <FormDescription>
                                                        {t(
                                                            "dnsBlockPageFieldMessageDescription",
                                                            {
                                                                domain: "{{domain}}",
                                                                orgName:
                                                                    "{{orgName}}"
                                                            }
                                                        )}
                                                    </FormDescription>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </SettingsFormCell>
                                    <SettingsFormCell span="full">
                                        <FormField
                                            control={form.control}
                                            name="contact"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t(
                                                            "dnsBlockPageFieldContact"
                                                        )}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Textarea
                                                            rows={2}
                                                            placeholder={t(
                                                                "dnsBlockPageFieldContactPlaceholder"
                                                            )}
                                                            disabled={disabled}
                                                            {...field}
                                                        />
                                                    </FormControl>
                                                    <FormDescription>
                                                        {t(
                                                            "dnsBlockPageFieldContactDescription"
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
                        form="dns-block-page-form"
                        loading={loading}
                        disabled={loading || disabled}
                    >
                        {t("saveSettings")}
                    </Button>
                </SettingsSectionFooter>
            </SettingsSection>

            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("dnsBlockPagePreview")}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("dnsBlockPagePreviewDescription", {
                            domain: PREVIEW_DOMAIN
                        })}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>
                <SettingsSectionBody>
                    <div className="max-w-md rounded-md border p-6 space-y-3">
                        <div className="flex items-center gap-2">
                            <ShieldBan className="h-5 w-5 text-destructive" />
                            <h3 className="font-semibold">
                                {title
                                    ? fillBlockPageText(title, vars)
                                    : defaultTitle}
                            </h3>
                        </div>
                        <p className="text-sm whitespace-pre-line">
                            {message
                                ? fillBlockPageText(message, vars)
                                : t("dnsBlockPageDefaultMessage", vars)}
                        </p>
                        {contact && (
                            <p className="text-sm text-muted-foreground whitespace-pre-line">
                                {fillBlockPageText(contact, vars)}
                            </p>
                        )}
                    </div>
                </SettingsSectionBody>
            </SettingsSection>
        </SettingsContainer>
    );
}
