"use client";

import UptimeAlertSection from "@app/components/UptimeAlertSection";

import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useSiteContext } from "@app/hooks/useSiteContext";
import { useForm } from "react-hook-form";
import { toast, useToast } from "@app/hooks/useToast";
import { useRouter } from "next/navigation";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionHeader,
    SettingsSectionTitle,
    SettingsSectionDescription,
    SettingsSectionBody,
    SettingsSectionForm,
    SettingsSectionFooter
} from "@app/components/Settings";
import { formatAxiosError } from "@app/lib/api";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useState } from "react";
import { SwitchInput } from "@app/components/SwitchInput";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOrgContext } from "@app/hooks/useOrgContext";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { tierMatrix, TierFeature } from "@server/lib/billing/tierMatrix";
import { Button as ButtonUI } from "@/components/ui/button";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";

const GeneralFormSchema = z.object({
    name: z.string().nonempty("Name is required"),
    niceId: z.string().min(1).max(255).optional(),
    dockerSocketEnabled: z.boolean().optional(),
    autoUpdateEnabled: z.boolean().optional(),
    autoUpdateOverrideOrg: z.boolean().optional(),
    publicIp: z.string().nullable().optional(),
    dnsAuthorityEnabled: z.boolean().optional()
});

type GeneralFormValues = z.infer<typeof GeneralFormSchema>;

export default function GeneralPage() {
    const { site, updateSite } = useSiteContext();
    const { org } = useOrgContext();

    const { env } = useEnvContext();
    const api = createApiClient(useEnvContext());
    const router = useRouter();
    const t = useTranslations();
    const { toast } = useToast();
    const { isPaidUser } = usePaidStatus();
    const hasAutoUpdateFeature = isPaidUser(
        tierMatrix[TierFeature.NewtAutoUpdate]
    );

    const [loading, setLoading] = useState(false);
    const [activeCidrTagIndex, setActiveCidrTagIndex] = useState<number | null>(
        null
    );

    const orgAutoUpdate = org.org.settingsEnableGlobalNewtAutoUpdate ?? false;

    const form = useForm({
        resolver: zodResolver(GeneralFormSchema),
        defaultValues: {
            name: site?.name,
            niceId: site?.niceId || "",
            dockerSocketEnabled: site?.dockerSocketEnabled ?? false,
            autoUpdateEnabled: site?.autoUpdateOverrideOrg
                ? (site?.autoUpdateEnabled ?? false)
                : orgAutoUpdate,
            autoUpdateOverrideOrg: site?.autoUpdateOverrideOrg ?? false,
            publicIp: site?.publicIp ?? "",
            dnsAuthorityEnabled: site?.dnsAuthorityEnabled ?? false
        },
        mode: "onChange"
    });

    async function onSubmit(data: GeneralFormValues) {
        setLoading(true);

        try {
            await api.post(`/site/${site?.siteId}`, {
                name: data.name,
                niceId: data.niceId,
                dockerSocketEnabled: data.dockerSocketEnabled,
                autoUpdateEnabled: data.autoUpdateEnabled,
                autoUpdateOverrideOrg: data.autoUpdateOverrideOrg,
                publicIp: data.publicIp || null,
                dnsAuthorityEnabled: data.dnsAuthorityEnabled
            });

            updateSite({
                name: data.name,
                niceId: data.niceId,
                dockerSocketEnabled: data.dockerSocketEnabled,
                autoUpdateEnabled: data.autoUpdateEnabled,
                autoUpdateOverrideOrg: data.autoUpdateOverrideOrg,
                publicIp: data.publicIp || null,
                dnsAuthorityEnabled: data.dnsAuthorityEnabled
            });

            if (data.niceId && data.niceId !== site?.niceId) {
                router.replace(
                    `/${site?.orgId}/settings/sites/${data.niceId}/general`
                );
            }

            toast({
                title: t("siteUpdated"),
                description: t("siteUpdatedDescription")
            });
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("siteErrorUpdate"),
                description: formatAxiosError(
                    e,
                    t("siteErrorUpdateDescription")
                )
            });
        }

        setLoading(false);

        router.refresh();
    }

    return (
        <SettingsContainer>
            {site?.siteId && site?.orgId && site.type != "local" && (
                <UptimeAlertSection
                    orgId={site.orgId}
                    siteId={site.siteId}
                    startingName={site.name}
                />
            )}
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("generalSettings")}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("siteGeneralDescription")}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>

                <SettingsSectionBody>
                    <SettingsSectionForm>
                        <Form {...form}>
                            <form
                                onSubmit={form.handleSubmit(onSubmit)}
                                className="space-y-6"
                                id="general-settings-form"
                            >
                                <FormField
                                    control={form.control}
                                    name="name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t("name")}</FormLabel>
                                            <FormControl>
                                                <Input {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

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
                                                    className="flex-1"
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {site && site.type === "newt" && (
                                    <FormField
                                        control={form.control}
                                        name="dockerSocketEnabled"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormControl>
                                                    <SwitchInput
                                                        id="docker-socket-enabled"
                                                        label={t(
                                                            "enableDockerSocket"
                                                        )}
                                                        defaultChecked={
                                                            field.value
                                                        }
                                                        onCheckedChange={
                                                            field.onChange
                                                        }
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                                <FormDescription>
                                                    {t.rich(
                                                        "enableDockerSocketDescription",
                                                        {
                                                            docsLink: (
                                                                chunks
                                                            ) => (
                                                                <a
                                                                    href="https://docs.pangolin.net/manage/sites/configure-site#docker-socket-integration"
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="text-primary hover:underline inline-flex items-center gap-1"
                                                                >
                                                                    {chunks}
                                                                    <ExternalLink className="size-3.5 shrink-0" />
                                                                </a>
                                                            )
                                                        }
                                                    )}
                                                </FormDescription>
                                            </FormItem>
                                        )}
                                    />
                                )}

                                <PaidFeaturesAlert
                                    tiers={tierMatrix.newtAutoUpdate}
                                />
                                {site && site.type === "newt" && (
                                    <FormField
                                        control={form.control}
                                        name="autoUpdateEnabled"
                                        render={({ field }) => {
                                            const isOverriding = form.watch(
                                                "autoUpdateOverrideOrg"
                                            );
                                            return (
                                                <FormItem>
                                                    <FormControl>
                                                        <div className="flex items-center gap-3">
                                                            <SwitchInput
                                                                id="auto-update-enabled"
                                                                label={t(
                                                                    "siteAutoUpdateLabel"
                                                                )}
                                                                checked={
                                                                    field.value
                                                                }
                                                                onCheckedChange={(
                                                                    checked
                                                                ) => {
                                                                    field.onChange(
                                                                        checked
                                                                    );
                                                                    form.setValue(
                                                                        "autoUpdateOverrideOrg",
                                                                        true
                                                                    );
                                                                }}
                                                                disabled={
                                                                    !hasAutoUpdateFeature
                                                                }
                                                            />
                                                            {isOverriding && (
                                                                <ButtonUI
                                                                    type="button"
                                                                    variant="link"
                                                                    size="sm"
                                                                    className="h-auto p-0 pb-2 text-xs"
                                                                    onClick={() => {
                                                                        form.setValue(
                                                                            "autoUpdateOverrideOrg",
                                                                            false
                                                                        );
                                                                        form.setValue(
                                                                            "autoUpdateEnabled",
                                                                            orgAutoUpdate
                                                                        );
                                                                    }}
                                                                >
                                                                    {t(
                                                                        "siteAutoUpdateResetToOrg"
                                                                    )}
                                                                </ButtonUI>
                                                            )}
                                                        </div>
                                                    </FormControl>
                                                    <FormDescription>
                                                        {t(
                                                            "siteAutoUpdateDescription"
                                                        )}
                                                    </FormDescription>
                                                    <FormMessage />
                                                </FormItem>
                                            );
                                        }}
                                    />
                                )}

                                <FormField
                                    control={form.control}
                                    name="dnsAuthorityEnabled"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormControl>
                                                <SwitchInput
                                                    id="dns-authority-enabled"
                                                    label={t(
                                                        "siteDnsAuthorityEnable"
                                                    )}
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                />
                                            </FormControl>
                                            <FormDescription>
                                                {t(
                                                    "siteDnsAuthorityDescription"
                                                )}
                                            </FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {form.watch("dnsAuthorityEnabled") && (
                                    <FormField
                                        control={form.control}
                                        name="publicIp"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t("sitePublicIp")}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input
                                                        {...field}
                                                        value={field.value || ""}
                                                        placeholder={t(
                                                            "sitePublicIpPlaceholder"
                                                        )}
                                                    />
                                                </FormControl>
                                                <FormDescription>
                                                    {t(
                                                        "sitePublicIpDescription"
                                                    )}
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                )}
                            </form>
                        </Form>
                    </SettingsSectionForm>
                </SettingsSectionBody>
                <SettingsSectionFooter>
                    <Button
                        type="submit"
                        form="general-settings-form"
                        loading={loading}
                        disabled={loading}
                    >
                        Save All Settings
                    </Button>
                </SettingsSectionFooter>
            </SettingsSection>
        </SettingsContainer>
    );
}
