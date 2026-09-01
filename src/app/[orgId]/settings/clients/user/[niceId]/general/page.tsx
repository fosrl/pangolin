"use client";

import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionFooter,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import { useClientContext } from "@app/hooks/useClientContext";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { useTranslations } from "next-intl";
import { build } from "@server/build";
import {
    InfoSection,
    InfoSectionContent,
    InfoSections,
    InfoSectionTitle
} from "@app/components/InfoSection";
import { Badge } from "@app/components/ui/badge";
import { Button } from "@app/components/ui/button";
import ActionBanner from "@app/components/ActionBanner";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { toast } from "@app/hooks/useToast";
import { useRouter } from "next/navigation";
import { useState, useEffect, useTransition } from "react";
import {
    Check,
    Ban,
    Shield,
    ShieldOff,
    Clock,
    CheckCircle2,
    XCircle
} from "lucide-react";
import { useParams } from "next/navigation";
import { FaApple, FaWindows, FaLinux } from "react-icons/fa";
import { SiAndroid } from "react-icons/si";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import {
    productUpdatesQueries,
    type LatestVersionResponse
} from "@app/lib/queries";
import { useQuery } from "@tanstack/react-query";
import semver from "semver";
import { InfoPopup } from "@app/components/ui/info-popup";

function formatTimestamp(timestamp: number | null | undefined): string {
    if (!timestamp) return "-";
    return new Date(timestamp * 1000).toLocaleString();
}

function formatPlatform(platform: string | null | undefined): string {
    if (!platform) return "-";
    const platformMap: Record<string, string> = {
        macos: "macOS",
        windows: "Windows",
        linux: "Linux",
        ios: "iOS",
        android: "Android",
        unknown: "Unknown"
    };
    return platformMap[platform.toLowerCase()] || platform;
}

function getPlatformIcon(platform: string | null | undefined) {
    if (!platform) return null;
    const normalizedPlatform = platform.toLowerCase();
    switch (normalizedPlatform) {
        case "macos":
        case "ios":
            return <FaApple className="h-4 w-4" />;
        case "windows":
            return <FaWindows className="h-4 w-4" />;
        case "linux":
            return <FaLinux className="h-4 w-4" />;
        case "android":
            return <SiAndroid className="h-4 w-4" />;
        default:
            return null;
    }
}

type FieldConfig = {
    show: boolean;
    labelKey: string;
};

function getPlatformFieldConfig(
    platform: string | null | undefined
): Record<string, FieldConfig> {
    const normalizedPlatform = platform?.toLowerCase() || "unknown";

    const configs: Record<string, Record<string, FieldConfig>> = {
        macos: {
            osVersion: { show: true, labelKey: "macosVersion" },
            kernelVersion: { show: false, labelKey: "kernelVersion" },
            arch: { show: true, labelKey: "architecture" },
            deviceModel: { show: true, labelKey: "deviceModel" },
            serialNumber: { show: true, labelKey: "serialNumber" },
            username: { show: true, labelKey: "username" },
            hostname: { show: true, labelKey: "hostname" }
        },
        windows: {
            osVersion: { show: true, labelKey: "windowsVersion" },
            kernelVersion: { show: true, labelKey: "kernelVersion" },
            arch: { show: true, labelKey: "architecture" },
            deviceModel: { show: true, labelKey: "deviceModel" },
            serialNumber: { show: true, labelKey: "serialNumber" },
            username: { show: true, labelKey: "username" },
            hostname: { show: true, labelKey: "hostname" }
        },
        linux: {
            osVersion: { show: true, labelKey: "osVersion" },
            kernelVersion: { show: true, labelKey: "kernelVersion" },
            arch: { show: true, labelKey: "architecture" },
            deviceModel: { show: true, labelKey: "deviceModel" },
            serialNumber: { show: true, labelKey: "serialNumber" },
            username: { show: true, labelKey: "username" },
            hostname: { show: true, labelKey: "hostname" }
        },
        ios: {
            osVersion: { show: true, labelKey: "iosVersion" },
            kernelVersion: { show: false, labelKey: "kernelVersion" },
            arch: { show: true, labelKey: "architecture" },
            deviceModel: { show: true, labelKey: "deviceModel" }
        },
        android: {
            osVersion: { show: true, labelKey: "androidVersion" },
            kernelVersion: { show: true, labelKey: "kernelVersion" },
            arch: { show: true, labelKey: "architecture" },
            deviceModel: { show: true, labelKey: "deviceModel" }
        },
        unknown: {
            osVersion: { show: true, labelKey: "osVersion" },
            kernelVersion: { show: true, labelKey: "kernelVersion" },
            arch: { show: true, labelKey: "architecture" },
            deviceModel: { show: true, labelKey: "deviceModel" },
            serialNumber: { show: true, labelKey: "serialNumber" },
            username: { show: true, labelKey: "username" },
            hostname: { show: true, labelKey: "hostname" }
        }
    };

    return configs[normalizedPlatform] || configs.unknown;
}

export default function GeneralPage() {
    const { client, updateClient } = useClientContext();
    const { isPaidUser } = usePaidStatus();
    const t = useTranslations();
    const api = createApiClient(useEnvContext());
    const router = useRouter();
    const params = useParams();
    const orgId = params.orgId as string;
    const [approvalId, setApprovalId] = useState<number | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [, startTransition] = useTransition();
    const [cacheCheck, setCacheCheck] = useState<null | {
        consistent: boolean;
        missingSiteResourceIds: number[];
        extraSiteResourceIds: number[];
        missingSiteIds: number[];
        extraSiteIds: number[];
        expectedSiteResourceIds: number[];
        actualSiteResourceIds: number[];
        expectedSiteIds: number[];
        actualSiteIds: number[];
    }>(null);
    const [isCheckingCache, setIsCheckingCache] = useState(false);
    const [isRebuildingCache, setIsRebuildingCache] = useState(false);
    const data = useQuery(productUpdatesQueries.latestVersion(true));
    const latestPlatformVersions = data.data?.data;

    const agentVersionMap: Record<string, string> = {
        "Pangolin Windows": "windows",
        "Pangolin Android": "android",
        "Pangolin iOS": "ios",
        "Pangolin iPadOS": "ios",
        "Pangolin macOS": "mac",
        "Pangolin CLI": "cli",
        "Olm CLI": "olm"
    };

    let updateAvailable = false;
    if (client.agent && client.olmVersion && latestPlatformVersions) {
        const agent = agentVersionMap[
            client.agent
        ] as keyof LatestVersionResponse;

        if (agent in latestPlatformVersions) {
            const agentVersion = latestPlatformVersions[agent];

            updateAvailable = Boolean(
                semver.valid(client.olmVersion) &&
                semver.lt(client.olmVersion, agentVersion.latestVersion)
            );
        }
    }

    // get "imp" from local storage to determine if we should show the verify button (imp = "1" means show)
    const showVerifyButton =
        typeof window !== "undefined" && localStorage.getItem("imp") === "1";

    const handleRebuildCache = async () => {
        if (!client.clientId) return;
        setIsRebuildingCache(true);
        try {
            await api.post(
                `/client/${client.clientId}/rebuild-associations-cache`
            );
            // Re-verify after rebuild so the result refreshes
            const res = await api.get(
                `/client/${client.clientId}/verify-associations-cache`
            );
            setCacheCheck(res.data.data);
            toast({
                title: "Cache rebuilt",
                description: "Association cache rebuilt successfully."
            });
        } catch (e) {
            toast({
                variant: "destructive",
                title: "Rebuild failed",
                description: formatAxiosError(e, "Failed to rebuild cache")
            });
        } finally {
            setIsRebuildingCache(false);
        }
    };

    const handleVerifyCache = async () => {
        if (!client.clientId) return;
        setIsCheckingCache(true);
        try {
            const res = await api.get(
                `/client/${client.clientId}/verify-associations-cache`
            );
            setCacheCheck(res.data.data);
        } catch (e) {
            toast({
                variant: "destructive",
                title: "Cache check failed",
                description: formatAxiosError(e, "Failed to verify cache")
            });
        } finally {
            setIsCheckingCache(false);
        }
    };
    const { env } = useEnvContext();

    const showApprovalFeatures =
        build !== "oss" && isPaidUser(tierMatrix.deviceApprovals);

    const formatPostureValue = (value: boolean | null | undefined | "-") => {
        if (value === null || value === undefined || value === "-") return "-";
        return (
            <div className="flex items-center gap-2">
                {value ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                    <XCircle className="h-4 w-4 text-red-600" />
                )}
                <span>{value ? t("enabled") : t("disabled")}</span>
            </div>
        );
    };

    // Fetch approval ID for this client if pending
    useEffect(() => {
        if (
            showApprovalFeatures &&
            client.approvalState === "pending" &&
            client.clientId
        ) {
            api.get(`/org/${orgId}/approvals?approvalState=pending`)
                .then((res) => {
                    const approval = res.data.data.approvals.find(
                        (a: any) => a.clientId === client.clientId
                    );
                    if (approval) {
                        setApprovalId(approval.approvalId);
                    }
                })
                .catch(() => {
                    // Silently fail - approval might not exist
                });
        }
    }, [
        showApprovalFeatures,
        client.approvalState,
        client.clientId,
        orgId,
        api
    ]);

    const handleApprove = async () => {
        if (!approvalId) return;
        setIsRefreshing(true);
        try {
            await api.put(`/org/${orgId}/approvals/${approvalId}`, {
                decision: "approved"
            });
            // Optimistically update the client context
            updateClient({ approvalState: "approved" });
            toast({
                title: t("accessApprovalUpdated"),
                description: t("accessApprovalApprovedDescription")
            });
            startTransition(() => {
                router.refresh();
            });
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("accessApprovalErrorUpdate"),
                description: formatAxiosError(
                    e,
                    t("accessApprovalErrorUpdateDescription")
                )
            });
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleDeny = async () => {
        if (!approvalId) return;
        setIsRefreshing(true);
        try {
            await api.put(`/org/${orgId}/approvals/${approvalId}`, {
                decision: "denied"
            });
            // Optimistically update the client context
            updateClient({ approvalState: "denied", blocked: true });
            toast({
                title: t("accessApprovalUpdated"),
                description: t("accessApprovalDeniedDescription")
            });
            startTransition(() => {
                router.refresh();
            });
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("accessApprovalErrorUpdate"),
                description: formatAxiosError(
                    e,
                    t("accessApprovalErrorUpdateDescription")
                )
            });
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleBlock = async () => {
        if (!client.clientId) return;
        setIsRefreshing(true);
        try {
            await api.post(`/client/${client.clientId}/block`);
            // Optimistically update the client context
            updateClient({ blocked: true, approvalState: "denied" });
            toast({
                title: t("blockClient"),
                description: t("blockClientMessage")
            });
            startTransition(() => {
                router.refresh();
            });
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("error"),
                description: formatAxiosError(e, t("error"))
            });
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleUnblock = async () => {
        if (!client.clientId) return;
        setIsRefreshing(true);
        try {
            await api.post(`/client/${client.clientId}/unblock`);
            // Optimistically update the client context
            updateClient({ blocked: false, approvalState: null });
            toast({
                title: t("unblockClient"),
                description: t("unblockClientDescription")
            });
            startTransition(() => {
                router.refresh();
            });
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("error"),
                description: formatAxiosError(e, t("error"))
            });
        } finally {
            setIsRefreshing(false);
        }
    };

    return (
        <SettingsContainer>
            {/* Pending Approval Banner */}
            {showApprovalFeatures && client.approvalState === "pending" && (
                <ActionBanner
                    variant="warning"
                    title={t("pendingApproval")}
                    titleIcon={<Clock className="w-5 h-5" />}
                    description={t("devicePendingApprovalBannerDescription")}
                    actions={
                        <>
                            <Button
                                onClick={handleApprove}
                                disabled={isRefreshing || !approvalId}
                                loading={isRefreshing}
                                variant="outline"
                                className="gap-2"
                            >
                                <Check className="size-4" />
                                {t("approve")}
                            </Button>
                            <Button
                                onClick={handleDeny}
                                disabled={isRefreshing || !approvalId}
                                loading={isRefreshing}
                                variant="outline"
                                className="gap-2"
                            >
                                <Ban className="size-4" />
                                {t("deny")}
                            </Button>
                        </>
                    }
                />
            )}

            {/* Blocked Device Banner */}
            {client.blocked && client.approvalState !== "pending" && (
                <ActionBanner
                    variant="destructive"
                    title={t("blocked")}
                    titleIcon={<Shield className="w-5 h-5" />}
                    description={t("deviceBlockedDescription")}
                    actions={
                        <Button
                            onClick={handleUnblock}
                            disabled={isRefreshing}
                            loading={isRefreshing}
                            variant="outline"
                            className="gap-2"
                        >
                            <ShieldOff className="size-4" />
                            {t("unblock")}
                        </Button>
                    }
                />
            )}

            {/* Device Information Section */}
            {(client.fingerprint || (client.agent && client.olmVersion)) && (
                <SettingsSection>
                    <SettingsSectionHeader>
                        <SettingsSectionTitle>
                            {t("deviceInformation")}
                        </SettingsSectionTitle>
                        <SettingsSectionDescription>
                            {t("deviceInformationDescription")}
                        </SettingsSectionDescription>
                    </SettingsSectionHeader>

                    <SettingsSectionBody>
                        {client.agent && client.olmVersion && (
                            <div className="mb-6">
                                <InfoSection>
                                    <InfoSectionTitle>
                                        {t("agent")}
                                    </InfoSectionTitle>
                                    <InfoSectionContent>
                                        <div className="flex items-center">
                                            <Badge variant="secondary">
                                                {client.agent +
                                                    " v" +
                                                    client.olmVersion}
                                            </Badge>

                                            {updateAvailable && (
                                                <InfoPopup
                                                    info={t(
                                                        "updateAvailableInfo"
                                                    )}
                                                />
                                            )}
                                        </div>
                                    </InfoSectionContent>
                                </InfoSection>
                            </div>
                        )}

                        {client.fingerprint &&
                            (() => {
                                const platform = client.fingerprint.platform;
                                const fieldConfig =
                                    getPlatformFieldConfig(platform);

                                return (
                                    <InfoSections cols={3}>
                                        {platform && (
                                            <InfoSection>
                                                <InfoSectionTitle>
                                                    {t("platform")}
                                                </InfoSectionTitle>
                                                <InfoSectionContent>
                                                    <div className="flex items-center gap-2">
                                                        {getPlatformIcon(
                                                            platform
                                                        )}
                                                        <span>
                                                            {formatPlatform(
                                                                platform
                                                            )}
                                                        </span>
                                                    </div>
                                                </InfoSectionContent>
                                            </InfoSection>
                                        )}

                                        {client.fingerprint.osVersion &&
                                            fieldConfig.osVersion?.show && (
                                                <InfoSection>
                                                    <InfoSectionTitle>
                                                        {t(
                                                            fieldConfig
                                                                .osVersion
                                                                ?.labelKey ||
                                                                "osVersion"
                                                        )}
                                                    </InfoSectionTitle>
                                                    <InfoSectionContent>
                                                        {
                                                            client.fingerprint
                                                                .osVersion
                                                        }
                                                    </InfoSectionContent>
                                                </InfoSection>
                                            )}

                                        {client.fingerprint.kernelVersion &&
                                            fieldConfig.kernelVersion?.show && (
                                                <InfoSection>
                                                    <InfoSectionTitle>
                                                        {t("kernelVersion")}
                                                    </InfoSectionTitle>
                                                    <InfoSectionContent>
                                                        {
                                                            client.fingerprint
                                                                .kernelVersion
                                                        }
                                                    </InfoSectionContent>
                                                </InfoSection>
                                            )}

                                        {client.fingerprint.arch &&
                                            fieldConfig.arch.show && (
                                                <InfoSection>
                                                    <InfoSectionTitle>
                                                        {t("architecture")}
                                                    </InfoSectionTitle>
                                                    <InfoSectionContent>
                                                        {
                                                            client.fingerprint
                                                                .arch
                                                        }
                                                    </InfoSectionContent>
                                                </InfoSection>
                                            )}

                                        {client.fingerprint.deviceModel &&
                                            fieldConfig.deviceModel?.show && (
                                                <InfoSection>
                                                    <InfoSectionTitle>
                                                        {t("deviceModel")}
                                                    </InfoSectionTitle>
                                                    <InfoSectionContent>
                                                        {
                                                            client.fingerprint
                                                                .deviceModel
                                                        }
                                                    </InfoSectionContent>
                                                </InfoSection>
                                            )}

                                        {client.fingerprint.serialNumber &&
                                            fieldConfig.serialNumber.show && (
                                                <InfoSection>
                                                    <InfoSectionTitle>
                                                        {t("serialNumber")}
                                                    </InfoSectionTitle>
                                                    <InfoSectionContent>
                                                        {
                                                            client.fingerprint
                                                                .serialNumber
                                                        }
                                                    </InfoSectionContent>
                                                </InfoSection>
                                            )}

                                        {client.fingerprint.username &&
                                            fieldConfig.username?.show && (
                                                <InfoSection>
                                                    <InfoSectionTitle>
                                                        {t("username")}
                                                    </InfoSectionTitle>
                                                    <InfoSectionContent>
                                                        {
                                                            client.fingerprint
                                                                .username
                                                        }
                                                    </InfoSectionContent>
                                                </InfoSection>
                                            )}

                                        {client.fingerprint.hostname &&
                                            fieldConfig.hostname?.show && (
                                                <InfoSection>
                                                    <InfoSectionTitle>
                                                        {t("hostname")}
                                                    </InfoSectionTitle>
                                                    <InfoSectionContent>
                                                        {
                                                            client.fingerprint
                                                                .hostname
                                                        }
                                                    </InfoSectionContent>
                                                </InfoSection>
                                            )}

                                        {client.fingerprint.firstSeen && (
                                            <InfoSection>
                                                <InfoSectionTitle>
                                                    {t("firstSeen")}
                                                </InfoSectionTitle>
                                                <InfoSectionContent>
                                                    {formatTimestamp(
                                                        client.fingerprint
                                                            .firstSeen
                                                    )}
                                                </InfoSectionContent>
                                            </InfoSection>
                                        )}

                                        {client.fingerprint.lastSeen && (
                                            <InfoSection>
                                                <InfoSectionTitle>
                                                    {t("lastSeen")}
                                                </InfoSectionTitle>
                                                <InfoSectionContent>
                                                    {formatTimestamp(
                                                        client.fingerprint
                                                            .lastSeen
                                                    )}
                                                </InfoSectionContent>
                                            </InfoSection>
                                        )}
                                    </InfoSections>
                                );
                            })()}
                    </SettingsSectionBody>
                </SettingsSection>
            )}

            {!env.flags.disableEnterpriseFeatures && (
                <SettingsSection>
                    <SettingsSectionHeader>
                        <SettingsSectionTitle>
                            {t("deviceSecurity")}
                        </SettingsSectionTitle>
                        <SettingsSectionDescription>
                            {t("deviceSecurityDescription")}
                        </SettingsSectionDescription>
                    </SettingsSectionHeader>

                    <SettingsSectionBody>
                        <PaidFeaturesAlert tiers={tierMatrix.devicePosture} />

                        {client.posture &&
                        Object.keys(client.posture).length > 0 ? (
                            <>
                                <InfoSections cols={3}>
                                    {client.posture.biometricsEnabled !==
                                        null &&
                                        client.posture.biometricsEnabled !==
                                            undefined && (
                                            <InfoSection>
                                                <InfoSectionTitle>
                                                    {t("biometricsEnabled")}
                                                </InfoSectionTitle>
                                                <InfoSectionContent>
                                                    {isPaidUser(
                                                        tierMatrix.devicePosture
                                                    )
                                                        ? formatPostureValue(
                                                              client.posture
                                                                  .biometricsEnabled ===
                                                                  true
                                                          )
                                                        : "-"}
                                                </InfoSectionContent>
                                            </InfoSection>
                                        )}

                                    {client.posture.diskEncrypted !== null &&
                                        client.posture.diskEncrypted !==
                                            undefined && (
                                            <InfoSection>
                                                <InfoSectionTitle>
                                                    {t("diskEncrypted")}
                                                </InfoSectionTitle>
                                                <InfoSectionContent>
                                                    {isPaidUser(
                                                        tierMatrix.devicePosture
                                                    )
                                                        ? formatPostureValue(
                                                              client.posture
                                                                  .diskEncrypted ===
                                                                  true
                                                          )
                                                        : "-"}
                                                </InfoSectionContent>
                                            </InfoSection>
                                        )}

                                    {client.posture.firewallEnabled !== null &&
                                        client.posture.firewallEnabled !==
                                            undefined && (
                                            <InfoSection>
                                                <InfoSectionTitle>
                                                    {t("firewallEnabled")}
                                                </InfoSectionTitle>
                                                <InfoSectionContent>
                                                    {isPaidUser(
                                                        tierMatrix.devicePosture
                                                    )
                                                        ? formatPostureValue(
                                                              client.posture
                                                                  .firewallEnabled ===
                                                                  true
                                                          )
                                                        : "-"}
                                                </InfoSectionContent>
                                            </InfoSection>
                                        )}

                                    {client.posture.autoUpdatesEnabled !==
                                        null &&
                                        client.posture.autoUpdatesEnabled !==
                                            undefined && (
                                            <InfoSection>
                                                <InfoSectionTitle>
                                                    {t("autoUpdatesEnabled")}
                                                </InfoSectionTitle>
                                                <InfoSectionContent>
                                                    {isPaidUser(
                                                        tierMatrix.devicePosture
                                                    )
                                                        ? formatPostureValue(
                                                              client.posture
                                                                  .autoUpdatesEnabled ===
                                                                  true
                                                          )
                                                        : "-"}
                                                </InfoSectionContent>
                                            </InfoSection>
                                        )}

                                    {client.posture.tpmAvailable !== null &&
                                        client.posture.tpmAvailable !==
                                            undefined && (
                                            <InfoSection>
                                                <InfoSectionTitle>
                                                    {t("tpmAvailable")}
                                                </InfoSectionTitle>
                                                <InfoSectionContent>
                                                    {isPaidUser(
                                                        tierMatrix.devicePosture
                                                    )
                                                        ? formatPostureValue(
                                                              client.posture
                                                                  .tpmAvailable ===
                                                                  true
                                                          )
                                                        : "-"}
                                                </InfoSectionContent>
                                            </InfoSection>
                                        )}

                                    {client.posture.windowsAntivirusEnabled !==
                                        null &&
                                        client.posture
                                            .windowsAntivirusEnabled !==
                                            undefined && (
                                            <InfoSection>
                                                <InfoSectionTitle>
                                                    {t(
                                                        "windowsAntivirusEnabled"
                                                    )}
                                                </InfoSectionTitle>
                                                <InfoSectionContent>
                                                    {isPaidUser(
                                                        tierMatrix.devicePosture
                                                    )
                                                        ? formatPostureValue(
                                                              client.posture
                                                                  .windowsAntivirusEnabled ===
                                                                  true
                                                          )
                                                        : "-"}
                                                </InfoSectionContent>
                                            </InfoSection>
                                        )}

                                    {client.posture.macosSipEnabled !== null &&
                                        client.posture.macosSipEnabled !==
                                            undefined && (
                                            <InfoSection>
                                                <InfoSectionTitle>
                                                    {t("macosSipEnabled")}
                                                </InfoSectionTitle>
                                                <InfoSectionContent>
                                                    {isPaidUser(
                                                        tierMatrix.devicePosture
                                                    )
                                                        ? formatPostureValue(
                                                              client.posture
                                                                  .macosSipEnabled ===
                                                                  true
                                                          )
                                                        : "-"}
                                                </InfoSectionContent>
                                            </InfoSection>
                                        )}

                                    {client.posture.macosGatekeeperEnabled !==
                                        null &&
                                        client.posture
                                            .macosGatekeeperEnabled !==
                                            undefined && (
                                            <InfoSection>
                                                <InfoSectionTitle>
                                                    {t(
                                                        "macosGatekeeperEnabled"
                                                    )}
                                                </InfoSectionTitle>
                                                <InfoSectionContent>
                                                    {isPaidUser(
                                                        tierMatrix.devicePosture
                                                    )
                                                        ? formatPostureValue(
                                                              client.posture
                                                                  .macosGatekeeperEnabled ===
                                                                  true
                                                          )
                                                        : "-"}
                                                </InfoSectionContent>
                                            </InfoSection>
                                        )}

                                    {client.posture.macosFirewallStealthMode !==
                                        null &&
                                        client.posture
                                            .macosFirewallStealthMode !==
                                            undefined && (
                                            <InfoSection>
                                                <InfoSectionTitle>
                                                    {t(
                                                        "macosFirewallStealthMode"
                                                    )}
                                                </InfoSectionTitle>
                                                <InfoSectionContent>
                                                    {isPaidUser(
                                                        tierMatrix.devicePosture
                                                    )
                                                        ? formatPostureValue(
                                                              client.posture
                                                                  .macosFirewallStealthMode ===
                                                                  true
                                                          )
                                                        : "-"}
                                                </InfoSectionContent>
                                            </InfoSection>
                                        )}

                                    {client.posture.linuxAppArmorEnabled !==
                                        null &&
                                        client.posture.linuxAppArmorEnabled !==
                                            undefined && (
                                            <InfoSection>
                                                <InfoSectionTitle>
                                                    {t("linuxAppArmorEnabled")}
                                                </InfoSectionTitle>
                                                <InfoSectionContent>
                                                    {isPaidUser(
                                                        tierMatrix.devicePosture
                                                    )
                                                        ? formatPostureValue(
                                                              client.posture
                                                                  .linuxAppArmorEnabled ===
                                                                  true
                                                          )
                                                        : "-"}
                                                </InfoSectionContent>
                                            </InfoSection>
                                        )}

                                    {client.posture.linuxSELinuxEnabled !==
                                        null &&
                                        client.posture.linuxSELinuxEnabled !==
                                            undefined && (
                                            <InfoSection>
                                                <InfoSectionTitle>
                                                    {t("linuxSELinuxEnabled")}
                                                </InfoSectionTitle>
                                                <InfoSectionContent>
                                                    {isPaidUser(
                                                        tierMatrix.devicePosture
                                                    )
                                                        ? formatPostureValue(
                                                              client.posture
                                                                  .linuxSELinuxEnabled ===
                                                                  true
                                                          )
                                                        : "-"}
                                                </InfoSectionContent>
                                            </InfoSection>
                                        )}
                                </InfoSections>
                            </>
                        ) : (
                            <div className="text-muted-foreground">
                                {t("noData")}
                            </div>
                        )}
                    </SettingsSectionBody>
                </SettingsSection>
            )}

            {showVerifyButton && (
                <div className="mt-8 flex flex-col gap-2 items-start opacity-30 hover:opacity-100 transition-opacity">
                    <button
                        type="button"
                        onClick={handleVerifyCache}
                        disabled={isCheckingCache}
                        className="text-xs text-muted-foreground underline disabled:opacity-50"
                        title="Verify the client's site association cache against current permissions (read-only)"
                    >
                        {isCheckingCache
                            ? "Checking cache…"
                            : "Verify association cache"}
                    </button>
                    {cacheCheck && (
                        <div
                            className={
                                "text-xs rounded border px-2 py-1 " +
                                (cacheCheck.consistent
                                    ? "border-green-600 text-green-700"
                                    : "border-red-600 text-red-700")
                            }
                        >
                            {cacheCheck.consistent ? (
                                <span className="flex items-center gap-1">
                                    <CheckCircle2 className="h-3 w-3" />
                                    Cache is consistent
                                </span>
                            ) : (
                                <div className="space-y-2">
                                    <div className="flex items-center gap-1 font-semibold">
                                        <XCircle className="h-3 w-3" />
                                        Cache is INCONSISTENT
                                    </div>
                                    <div>
                                        Missing site resources: [
                                        {cacheCheck.missingSiteResourceIds.join(
                                            ", "
                                        )}
                                        ]
                                    </div>
                                    <div>
                                        Extra site resources: [
                                        {cacheCheck.extraSiteResourceIds.join(
                                            ", "
                                        )}
                                        ]
                                    </div>
                                    <div>
                                        Missing sites: [
                                        {cacheCheck.missingSiteIds.join(", ")}]
                                    </div>
                                    <div>
                                        Extra sites: [
                                        {cacheCheck.extraSiteIds.join(", ")}]
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleRebuildCache}
                                        disabled={isRebuildingCache}
                                        className="mt-1 text-xs underline font-semibold disabled:opacity-50"
                                    >
                                        {isRebuildingCache
                                            ? "Rebuilding…"
                                            : "Rebuild cache now"}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </SettingsContainer>
    );
}
