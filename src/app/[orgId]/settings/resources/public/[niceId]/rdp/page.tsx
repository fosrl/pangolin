"use client";

import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import { BrowserGatewayTargetForm } from "@app/components/BrowserGatewayTargetForm";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@app/components/ui/select";
import { runRdpEntraPopup } from "@app/lib/rdpEntraPopup";
import { createRdpEntraDeviceFormSchema } from "@app/lib/rdpEntraDeviceForm";
import type { RdpEntraDeviceFormValues } from "@app/lib/rdpEntraDeviceForm";
import type { ListResourceRdpEntraIdpsResponse } from "@server/routers/resource";
import { toast } from "@app/hooks/useToast";
import { useResourceContext } from "@app/hooks/useResourceContext";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { createBrowserGatewayTargetFormSchema } from "@app/lib/browserGatewayTargetFormSchema";
import type { BrowserGatewayTargetFormValues } from "@app/lib/browserGatewayTargetFormSchema";
import { tierMatrix, TierFeature } from "@server/lib/billing/tierMatrix";
import { createApiClient } from "@app/lib/api";
import { formatAxiosError } from "@app/lib/api/formatAxiosError";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { use, useActionState, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { GetResourceResponse } from "@server/routers/resource";
import type { ResourceContextType } from "@app/contexts/resourceContext";

type ExistingTarget = {
    targetId: number;
    siteId: number;
};

type TargetRow = {
    targetId: number;
    resourceId: number;
    siteId: number;
    siteName?: string;
    mode: string | null;
    ip: string;
    port: number;
};

type ResourceTargetsResponse = {
    targets: TargetRow[];
};

export default function RdpSettingsPage(props: {
    params: Promise<{ orgId: string }>;
}) {
    const params = use(props.params);
    const { resource, updateResource } = useResourceContext();
    const api = createApiClient(useEnvContext());

    const { data: targetsResponse, isLoading: isLoadingTargets } = useQuery({
        queryKey: ["resourceTargets", resource.resourceId, params.orgId, "rdp"],
        queryFn: async () => {
            const res = await api.get(`/resource/${resource.resourceId}/targets`);
            return res.data.data as ResourceTargetsResponse;
        }
    });

    if (isLoadingTargets) {
        return null;
    }

    return (
        <SettingsContainer>
            <RdpServerForm
                orgId={params.orgId}
                resource={resource}
                updateResource={updateResource}
                targetsResponse={targetsResponse ?? { targets: [] }}
            />
            <RdpEntraForm resource={resource} updateResource={updateResource} />
        </SettingsContainer>
    );
}

function RdpServerForm({
    orgId,
    resource,
    targetsResponse
}: {
    orgId: string;
    resource: GetResourceResponse;
    updateResource: ResourceContextType["updateResource"];
    targetsResponse: ResourceTargetsResponse;
}) {
    const t = useTranslations();
    const api = createApiClient(useEnvContext());
    const router = useRouter();
    const targets = targetsResponse.targets.filter((t) => t.mode === "rdp");
    const firstTarget = targets[0];

    const formSchema = useMemo(
        () => createBrowserGatewayTargetFormSchema(t),
        [t]
    );

    const form = useForm<BrowserGatewayTargetFormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            selectedSites: targets.map((target) => ({
                siteId: target.siteId,
                name: target.siteName ?? String(target.siteId),
                type: "newt" as const
            })),
            destination: firstTarget?.ip ?? "",
            destinationPort: firstTarget ? String(firstTarget.port) : "3389"
        }
    });

    const [existingTargets, setExistingTargets] = useState<ExistingTarget[]>(
        () =>
            targets.map((target) => ({
                targetId: target.targetId,
                siteId: target.siteId
            }))
    );

    const [, formAction, isSubmitting] = useActionState(save, null);

    async function save() {
        const isValid = await form.trigger();
        if (!isValid) return;

        const { selectedSites, destination, destinationPort } =
            form.getValues();

        try {
            const selectedSiteIds = new Set(selectedSites.map((s) => s.siteId));
            const existingSiteIds = new Set(
                existingTargets.map((t) => t.siteId)
            );

            const toDelete = existingTargets.filter(
                (t) => !selectedSiteIds.has(t.siteId)
            );
            await Promise.all(toDelete.map((t) => api.delete(`/target/${t.targetId}`)));

            const toUpdate = existingTargets.filter((t) =>
                selectedSiteIds.has(t.siteId)
            );
            await Promise.all(
                toUpdate.map((t) =>
                    api.post(`/target/${t.targetId}`, {
                        mode: "rdp",
                        ip: destination,
                        port: Number(destinationPort),
                        siteId: t.siteId,
                        hcEnabled: false
                    })
                )
            );

            const toCreate = selectedSites.filter(
                (s) => !existingSiteIds.has(s.siteId)
            );
            const created = await Promise.all(
                toCreate.map((s) =>
                    api.put(`/resource/${resource.resourceId}/target`, {
                        siteId: s.siteId,
                        mode: "rdp",
                        ip: destination,
                        port: Number(destinationPort),
                        hcEnabled: false
                    })
                )
            );

            const newTargets: ExistingTarget[] = created.map((res, i) => ({
                targetId: res.data.data.targetId,
                siteId: toCreate[i].siteId
            }));
            setExistingTargets([...toUpdate, ...newTargets]);

            toast({
                title: t("settingsUpdated"),
                description: t("settingsUpdatedDescription")
            });
            router.refresh();
        } catch (err) {
            console.error(err);
            toast({
                variant: "destructive",
                title: t("settingsErrorUpdate"),
                description: formatAxiosError(
                    err,
                    t("settingsErrorUpdateDescription")
                )
            });
        }
    }

    return (
        <SettingsSection>
            <SettingsSectionHeader>
                <SettingsSectionTitle>{t("rdpServer")}</SettingsSectionTitle>
                <SettingsSectionDescription>
                    {t("rdpServerDescription")}
                </SettingsSectionDescription>
            </SettingsSectionHeader>
                <Form {...form}>
                    <SettingsSectionBody>
                        <SettingsSectionForm variant="half">
                            <BrowserGatewayTargetForm
                                control={form.control}
                                orgId={orgId}
                                multiSite={true}
                                sitesField="selectedSites"
                                destinationField="destination"
                                destinationPortField="destinationPort"
                                learnMoreHref="https://docs.pangolin.net/manage/resources/public/rdp#site-and-host-configuration"
                                defaultPort={3389}
                            />
                        </SettingsSectionForm>
                    </SettingsSectionBody>
                    <form action={formAction} className="flex justify-end mt-4">
                        <Button
                            disabled={isSubmitting}
                            loading={isSubmitting}
                            type="submit"
                        >
                            {t("saveSettings")}
                        </Button>
                    </form>
                </Form>
        </SettingsSection>
    );
}

function RdpEntraForm({
    resource,
    updateResource
}: {
    resource: GetResourceResponse;
    updateResource: ResourceContextType["updateResource"];
}) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const api = createApiClient(useEnvContext());
    const router = useRouter();

    const { data: entraIdps } = useQuery({
        queryKey: ["resourceRdpEntraIdps", resource.resourceId],
        queryFn: async () => {
            const res = await api.get(
                `/resource/${resource.resourceId}/rdp-entra-idps`
            );
            return (res.data.data as ListResourceRdpEntraIdpsResponse).idps;
        }
    });

    const [devices, setDevices] = useState<
        { deviceId: string; name: string }[] | null
    >(null);
    const [loadingDevices, setLoadingDevices] = useState(false);

    async function loadDevices() {
        setLoadingDevices(true);
        try {
            const result = await runRdpEntraPopup({
                dashboardUrl: env.app.dashboardUrl,
                idpId: String(entraIdps?.[0]?.idpId ?? ""),
                params: async () => ({ purpose: "devices" }),
                messages: {
                    noIdp: t("rdpEntraNoIdp"),
                    popupBlocked: t("rdpEntraPopupBlocked"),
                    cancelled: t("rdpEntraSignInCancelled"),
                    timeout: t("rdpEntraSignInTimeout")
                }
            });
            const found = result.devices ?? [];
            setDevices(found);
            if (found.length === 1) {
                form.setValue("rdpEntraDeviceId", found[0].deviceId, {
                    shouldValidate: true
                });
            }
        } catch (err) {
            toast({
                variant: "destructive",
                title: t("rdpEntraDevicesFailed"),
                description: err instanceof Error ? err.message : String(err)
            });
        } finally {
            setLoadingDevices(false);
        }
    }

    const formSchema = useMemo(
        () => createRdpEntraDeviceFormSchema(t),
        [t]
    );

    const form = useForm<RdpEntraDeviceFormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            rdpEntraDeviceId: resource.rdpEntraDeviceId ?? ""
        }
    });

    const [, formAction, isSubmitting] = useActionState(save, null);

    async function save() {
        const isValid = await form.trigger();
        if (!isValid) return;

        const rdpEntraDeviceId =
            form.getValues().rdpEntraDeviceId.trim() || null;

        try {
            await api.post(`/resource/${resource.resourceId}`, {
                rdpEntraDeviceId
            });
            updateResource({ rdpEntraDeviceId });

            toast({
                title: t("settingsUpdated"),
                description: t("settingsUpdatedDescription")
            });
            router.refresh();
        } catch (err) {
            console.error(err);
            toast({
                variant: "destructive",
                title: t("settingsErrorUpdate"),
                description: formatAxiosError(
                    err,
                    t("settingsErrorUpdateDescription")
                )
            });
        }
    }

    return (
        <SettingsSection>
            <SettingsSectionHeader>
                <SettingsSectionTitle>{t("rdpEntraSettings")}</SettingsSectionTitle>
                <SettingsSectionDescription>
                    {t("rdpEntraSettingsDescription")}
                </SettingsSectionDescription>
            </SettingsSectionHeader>
            <Form {...form}>
                <SettingsSectionBody>
                    <SettingsSectionForm variant="half">
                        <FormField
                            control={form.control}
                            name="rdpEntraDeviceId"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>
                                        {t("rdpEntraDeviceId")}
                                    </FormLabel>
                                    <FormControl>
                                        <Input
                                            autoComplete="off"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormDescription>
                                        {t("rdpEntraDeviceIdDescription")}
                                    </FormDescription>
                                    {devices && devices.length > 0 && (
                                        <Select
                                            value={
                                                devices.some(
                                                    (device) =>
                                                        device.deviceId ===
                                                        field.value
                                                )
                                                    ? field.value
                                                    : ""
                                            }
                                            onValueChange={field.onChange}
                                        >
                                            <SelectTrigger>
                                                <SelectValue
                                                    placeholder={t(
                                                        "rdpEntraDeviceSelect"
                                                    )}
                                                />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {devices.map((device) => (
                                                    <SelectItem
                                                        key={device.deviceId}
                                                        value={device.deviceId}
                                                    >
                                                        {device.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                    {devices && devices.length === 0 && (
                                        <FormDescription>
                                            {t("rdpEntraNoDevices")}
                                        </FormDescription>
                                    )}
                                    {entraIdps && entraIdps.length > 0 && (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            loading={loadingDevices}
                                            disabled={loadingDevices}
                                            onClick={() => void loadDevices()}
                                        >
                                            {t("rdpEntraChooseDevice")}
                                        </Button>
                                    )}
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </SettingsSectionForm>
                </SettingsSectionBody>
                <form action={formAction} className="flex justify-end mt-4">
                    <Button
                        disabled={isSubmitting}
                        loading={isSubmitting}
                        type="submit"
                    >
                        {t("saveSettings")}
                    </Button>
                </form>
            </Form>
        </SettingsSection>
    );
}
