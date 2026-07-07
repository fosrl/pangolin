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
import { Form } from "@app/components/ui/form";
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
    const { isPaidUser } = usePaidStatus();
    const api = createApiClient(useEnvContext());
    const disabled = !isPaidUser(
        tierMatrix[TierFeature.AdvancedPublicResources]
    );

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
            <PaidFeaturesAlert
                tiers={tierMatrix[TierFeature.AdvancedPublicResources]}
            />
            <RdpServerForm
                orgId={params.orgId}
                resource={resource}
                updateResource={updateResource}
                disabled={disabled}
                targetsResponse={targetsResponse ?? { targets: [] }}
            />
        </SettingsContainer>
    );
}

function RdpServerForm({
    orgId,
    resource,
    disabled,
    targetsResponse
}: {
    orgId: string;
    resource: GetResourceResponse;
    updateResource: ResourceContextType["updateResource"];
    disabled: boolean;
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
            <fieldset
                disabled={disabled}
                className={disabled ? "opacity-50 pointer-events-none" : ""}
            >
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
            </fieldset>
        </SettingsSection>
    );
}
