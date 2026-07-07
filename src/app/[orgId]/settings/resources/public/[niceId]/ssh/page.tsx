"use client";

import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsFormCell,
    SettingsFormGrid,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle,
    SettingsSubsectionDescription,
    SettingsSubsectionHeader,
    SettingsSubsectionTitle
} from "@app/components/Settings";
import { StrategySelect, StrategyOption } from "@app/components/StrategySelect";
import { BrowserGatewayTargetForm } from "@app/components/BrowserGatewayTargetForm";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { SitesSelector } from "@app/components/site-selector";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { tierMatrix, TierFeature } from "@server/lib/billing/tierMatrix";
import { Button } from "@app/components/ui/button";
import { Input } from "@app/components/ui/input";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
import { ChevronsUpDown, ExternalLink } from "lucide-react";
import { Badge } from "@app/components/ui/badge";
import { toast } from "@app/hooks/useToast";
import { useResourceContext } from "@app/hooks/useResourceContext";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { createSshSettingsFormSchema } from "@app/lib/browserGatewayTargetFormSchema";
import type { SshSettingsFormValues } from "@app/lib/browserGatewayTargetFormSchema";
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

export default function SshSettingsPage(props: {
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
        queryKey: ["resourceTargets", resource.resourceId, params.orgId, "ssh"],
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
            <SshServerForm
                orgId={params.orgId}
                resource={resource}
                updateResource={updateResource}
                disabled={disabled}
                targetsResponse={targetsResponse ?? { targets: [] }}
            />
        </SettingsContainer>
    );
}

function SshServerForm({
    orgId,
    resource,
    updateResource,
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

    const isNativeInitially = resource.authDaemonMode === "native";
    const targets = targetsResponse.targets.filter((t) => t.mode === "ssh");
    const firstTarget = targets[0];
    const initialPamMode =
        (resource.pamMode as "passthrough" | "push") || "passthrough";
    const initialStandardDaemonLocation = isNativeInitially
        ? "site"
        : ((resource.authDaemonMode as "site" | "remote") || "site");
    const useSingleSiteOnLoad =
        !isNativeInitially &&
        initialPamMode === "push" &&
        initialStandardDaemonLocation === "site";

    const [sshServerMode] = useState<"standard" | "native">(
        isNativeInitially ? "native" : "standard"
    );
    const isNative = sshServerMode === "native";

    const formSchema = useMemo(
        () => createSshSettingsFormSchema(t, { isNative }),
        [t, isNative]
    );

    const form = useForm<SshSettingsFormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            pamMode: initialPamMode,
            standardDaemonLocation: initialStandardDaemonLocation,
            authDaemonPort: (resource as { authDaemonPort?: number })
                .authDaemonPort
                ? String((resource as { authDaemonPort?: number }).authDaemonPort)
                : "22123",
            selectedSites:
                isNativeInitially || useSingleSiteOnLoad
                    ? []
                    : targets.map((target) => ({
                          siteId: target.siteId,
                          name: target.siteName ?? String(target.siteId),
                          type: "newt" as const
                      })),
            selectedSite:
                useSingleSiteOnLoad && firstTarget
                    ? {
                          siteId: firstTarget.siteId,
                          name:
                              firstTarget.siteName ??
                              String(firstTarget.siteId),
                          type: "newt" as const
                      }
                    : null,
            selectedNativeSite:
                isNativeInitially && firstTarget
                    ? {
                          siteId: firstTarget.siteId,
                          name:
                              firstTarget.siteName ??
                              String(firstTarget.siteId),
                          type: "newt" as const
                      }
                    : null,
            destination: isNativeInitially
                ? ""
                                : (firstTarget?.ip ?? ""),
            destinationPort: isNativeInitially
                ? "22"
                : firstTarget
                                    ? String(firstTarget.port)
                  : "22"
        }
    });

    const [existingTargets, setExistingTargets] = useState<ExistingTarget[]>(
        () =>
            isNativeInitially
                ? []
                : targets.map((target) => ({
                      targetId: target.targetId,
                      siteId: target.siteId,
                  }))
    );

    const [nativeExistingTarget, setNativeExistingTarget] =
        useState<ExistingTarget | null>(() =>
            isNativeInitially && firstTarget
                ? {
                      targetId: firstTarget.targetId,
                      siteId: firstTarget.siteId,
                  }
                : null
        );
    const [nativeSiteOpen, setNativeSiteOpen] = useState(false);
    const [, formAction, isSubmitting] = useActionState(save, null);

    const pamMode = form.watch("pamMode");
    const standardDaemonLocation = form.watch("standardDaemonLocation");
    const selectedNativeSite = form.watch("selectedNativeSite");

    async function save() {
        const isValid = await form.trigger();
        if (!isValid) return;

        const values = form.getValues();
        const effectiveMode = isNative ? "native" : values.standardDaemonLocation;
        const effectivePort =
            !isNative &&
            values.standardDaemonLocation === "remote" &&
            values.authDaemonPort
                ? Number(values.authDaemonPort)
                : null;

        try {
            await api.post(`/resource/${resource.resourceId}`, {
                pamMode: values.pamMode,
                authDaemonMode: effectiveMode,
                authDaemonPort: effectivePort
            });

            updateResource({
                ...resource,
                pamMode: values.pamMode,
                authDaemonMode: effectiveMode
            });

            if (isNative) {
                const nativeSite = values.selectedNativeSite;
                if (nativeSite) {
                    if (nativeExistingTarget) {
                        await api.post(
                            `/target/${nativeExistingTarget.targetId}`,
                            {
                                mode: "ssh",
                                ip: "localhost",
                                port: 22,
                                siteId: nativeSite.siteId,
                                hcEnabled: false
                            }
                        );
                        setNativeExistingTarget({
                            ...nativeExistingTarget,
                            siteId: nativeSite.siteId
                        });
                    } else {
                        const res = await api.put(
                            `/resource/${resource.resourceId}/target`,
                            {
                                siteId: nativeSite.siteId,
                                mode: "ssh",
                                ip: "localhost",
                                port: 22,
                                hcEnabled: false
                            }
                        );
                        setNativeExistingTarget({
                            targetId: res.data.data.targetId,
                            siteId: nativeSite.siteId,
                        });
                    }
                }
            } else {
                const useMultiSite =
                    values.standardDaemonLocation !== "site" ||
                    values.pamMode === "passthrough";
                const activeSites = useMultiSite
                    ? values.selectedSites
                    : values.selectedSite
                      ? [values.selectedSite]
                      : [];
                const selectedSiteIds = new Set(
                    activeSites.map((s) => s.siteId)
                );
                const existingSiteIds = new Set(
                    existingTargets.map((t) => t.siteId)
                );

                const toDelete = existingTargets.filter(
                    (t) => !selectedSiteIds.has(t.siteId)
                );
                await Promise.all(
                    toDelete.map((t) => api.delete(`/target/${t.targetId}`))
                );

                const toUpdate = existingTargets.filter((t) =>
                    selectedSiteIds.has(t.siteId)
                );
                await Promise.all(
                    toUpdate.map((t) =>
                        api.post(`/target/${t.targetId}`, {
                            mode: "ssh",
                            ip: values.destination,
                            port: Number(values.destinationPort),
                            siteId: t.siteId,
                            hcEnabled: false
                        })
                    )
                );

                const toCreate = activeSites.filter(
                    (s) => !existingSiteIds.has(s.siteId)
                );
                const created = await Promise.all(
                    toCreate.map((s) =>
                        api.put(`/resource/${resource.resourceId}/target`, {
                            siteId: s.siteId,
                            mode: "ssh",
                            ip: values.destination,
                            port: Number(values.destinationPort),
                            hcEnabled: false
                        })
                    )
                );

                const newTargets: ExistingTarget[] = created.map((res, i) => ({
                    targetId: res.data.data.targetId,
                    siteId: toCreate[i].siteId,
                }));
                setExistingTargets([...toUpdate, ...newTargets]);
            }

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

    const authMethodOptions: StrategyOption<"passthrough" | "push">[] = [
        {
            id: "passthrough",
            title: t("sshAuthMethodManual"),
            description: t("sshAuthMethodManualDescription")
        },
        {
            id: "push",
            title: t("sshAuthMethodAutomated"),
            description: t("sshAuthMethodAutomatedDescription")
        }
    ];

    const daemonLocationOptions: StrategyOption<"site" | "remote">[] = [
        {
            id: "site",
            title: t("internalResourceAuthDaemonSite"),
            description: t("sshDaemonLocationSiteDescription")
        },
        {
            id: "remote",
            title: t("sshDaemonLocationRemote"),
            description: t("sshDaemonLocationRemoteDescription")
        }
    ];

    const showDaemonLocation = !isNative && pamMode === "push";
    const showDaemonPort =
        !isNative && pamMode === "push" && standardDaemonLocation === "remote";
    const useMultiSiteTargetForm =
        !isNative &&
        (standardDaemonLocation !== "site" || pamMode === "passthrough");

    return (
        <SettingsSection>
            <SettingsSectionHeader>
                <SettingsSectionTitle>{t("sshServer")}</SettingsSectionTitle>
                <SettingsSectionDescription>
                    {t("sshServerDescription")}
                </SettingsSectionDescription>
            </SettingsSectionHeader>
            <fieldset
                disabled={disabled}
                className={disabled ? "opacity-50 pointer-events-none" : ""}
            >
                <Form {...form}>
                    <SettingsSectionBody>
                        <SettingsSectionForm variant="half">
                            <SettingsFormGrid>
                                <SettingsFormCell span="full">
                                    <div className="space-y-2">
                                        <p className="font-semibold text-sm">
                                            {t("sshServerMode")}
                                        </p>
                                        <Badge variant="secondary">
                                            {sshServerMode == "standard"
                                                ? t("sshServerModeStandard")
                                                : t("sshServerModePangolin")}
                                        </Badge>
                                    </div>
                                </SettingsFormCell>

                                <SettingsFormCell span="full">
                                    <div className="space-y-2">
                                        <p className="font-semibold text-sm">
                                            {t("sshAuthenticationMethod")}
                                        </p>
                                        <StrategySelect<"passthrough" | "push">
                                            value={pamMode}
                                            options={authMethodOptions}
                                            onChange={(value) =>
                                                form.setValue("pamMode", value, {
                                                    shouldValidate: true
                                                })
                                            }
                                            cols={2}
                                        />
                                    </div>
                                </SettingsFormCell>

                                {showDaemonLocation && (
                                    <SettingsFormCell span="full">
                                        <div className="space-y-2">
                                            <p className="font-semibold text-sm">
                                                {t("sshAuthDaemonLocation")}
                                            </p>
                                            <StrategySelect<"site" | "remote">
                                                value={standardDaemonLocation}
                                                options={daemonLocationOptions}
                                                onChange={(value) =>
                                                    form.setValue(
                                                        "standardDaemonLocation",
                                                        value,
                                                        {
                                                            shouldValidate: true
                                                        }
                                                    )
                                                }
                                                cols={2}
                                            />
                                            <p className="text-sm text-muted-foreground">
                                                {t("sshDaemonDisclaimer")}{" "}
                                                <a
                                                    href="https://docs.pangolin.net/manage/ssh"
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-primary hover:underline inline-flex items-center gap-1"
                                                >
                                                    {t("learnMore")}
                                                    <ExternalLink className="size-3.5 shrink-0" />
                                                </a>
                                            </p>
                                        </div>
                                    </SettingsFormCell>
                                )}

                                {showDaemonPort && (
                                    <SettingsFormCell span="half">
                                        <FormField
                                            control={form.control}
                                            name="authDaemonPort"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t("sshDaemonPort")}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            type="number"
                                                            min={1}
                                                            max={65535}
                                                            {...field}
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </SettingsFormCell>
                                )}

                                <SettingsFormCell span="full">
                                    <SettingsSubsectionHeader>
                                        <SettingsSubsectionTitle>
                                            {t("sshServerDestination")}
                                        </SettingsSubsectionTitle>
                                        <SettingsSubsectionDescription>
                                            {t(
                                                "sshServerDestinationDescription"
                                            )}
                                        </SettingsSubsectionDescription>
                                    </SettingsSubsectionHeader>
                                </SettingsFormCell>

                                {isNative ? (
                                    <SettingsFormCell span="half">
                                        <FormField
                                            control={form.control}
                                            name="selectedNativeSite"
                                            render={() => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t("sites")}
                                                    </FormLabel>
                                                    <Popover
                                                        open={nativeSiteOpen}
                                                        onOpenChange={
                                                            setNativeSiteOpen
                                                        }
                                                    >
                                                        <PopoverTrigger asChild>
                                                            <FormControl>
                                                                <Button
                                                                    variant="outline"
                                                                    role="combobox"
                                                                    className="w-full justify-between font-normal"
                                                                >
                                                                    <span className="truncate">
                                                                        {selectedNativeSite?.name ??
                                                                            t(
                                                                                "siteSelect"
                                                                            )}
                                                                    </span>
                                                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                                </Button>
                                                            </FormControl>
                                                        </PopoverTrigger>
                                                        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                                                            <SitesSelector
                                                                orgId={orgId}
                                                                selectedSite={
                                                                    selectedNativeSite
                                                                }
                                                                onSelectSite={(
                                                                    site
                                                                ) => {
                                                                    form.setValue(
                                                                        "selectedNativeSite",
                                                                        site,
                                                                        {
                                                                            shouldValidate:
                                                                                true
                                                                        }
                                                                    );
                                                                    setNativeSiteOpen(
                                                                        false
                                                                    );
                                                                }}
                                                            />
                                                        </PopoverContent>
                                                    </Popover>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </SettingsFormCell>
                                ) : useMultiSiteTargetForm ? (
                                    <SettingsFormCell span="full">
                                        <BrowserGatewayTargetForm
                                            control={form.control}
                                            orgId={orgId}
                                            multiSite={true}
                                            sitesField="selectedSites"
                                            destinationField="destination"
                                            destinationPortField="destinationPort"
                                            learnMoreHref="https://docs.pangolin.net/manage/resources/public/ssh#site-and-host-configuration"
                                            defaultPort={22}
                                        />
                                    </SettingsFormCell>
                                ) : (
                                    <SettingsFormCell span="full">
                                        <BrowserGatewayTargetForm
                                            control={form.control}
                                            orgId={orgId}
                                            multiSite={false}
                                            siteField="selectedSite"
                                            destinationField="destination"
                                            destinationPortField="destinationPort"
                                            learnMoreHref="https://docs.pangolin.net/manage/resources/public/ssh#site-and-host-configuration"
                                            defaultPort={22}
                                        />
                                    </SettingsFormCell>
                                )}
                            </SettingsFormGrid>
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
