"use client";

import { Button } from "@app/components/ui/button";
import { useOrgContext } from "@app/hooks/useOrgContext";
import { toast } from "@app/hooks/useToast";
import { useState, useEffect } from "react";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { formatAxiosError } from "@app/lib/api";
import { AxiosResponse } from "axios";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionHeader,
    SettingsSectionTitle,
    SettingsSectionDescription,
    SettingsSectionBody,
    SettingsSectionFooter
} from "@app/components/Settings";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
    CreditCard,
    Database,
    Clock,
    AlertCircle,
    CheckCircle,
    Users,
    Calculator,
    ExternalLink,
    Gift,
    Server
} from "lucide-react";
import { InfoPopup } from "@/components/ui/info-popup";
import {
    GetOrgSubscriptionResponse,
    GetOrgUsageResponse
} from "@server/routers/billing/types";
import { useTranslations } from "use-intl";
import Link from "next/link";

export default function GeneralPage() {
    const { org } = useOrgContext();
    const api = createApiClient(useEnvContext());
    const t = useTranslations();

    // Subscription state
    const [subscription, setSubscription] =
        useState<GetOrgSubscriptionResponse["subscription"]>(null);
    const [subscriptionItems, setSubscriptionItems] = useState<
        GetOrgSubscriptionResponse["items"]
    >([]);
    const [subscriptionLoading, setSubscriptionLoading] = useState(true);

    // Example usage data (replace with real usage data if available)
    const [usageData, setUsageData] = useState<GetOrgUsageResponse["usage"]>(
        []
    );
    const [limitsData, setLimitsData] = useState<GetOrgUsageResponse["limits"]>(
        []
    );

    useEffect(() => {
        async function fetchSubscription() {
            setSubscriptionLoading(true);
            try {
                const res = await api.get<
                    AxiosResponse<GetOrgSubscriptionResponse>
                >(`/org/${org.org.orgId}/billing/subscription`);
                const { subscription, items } = res.data.data;
                setSubscription(subscription);
                setSubscriptionItems(items);
                setHasSubscription(
                    !!subscription && subscription.status === "active"
                );
            } catch (error) {
                toast({
                    title: t("billingFailedToLoadSubscription"),
                    description: formatAxiosError(error),
                    variant: "destructive"
                });
            } finally {
                setSubscriptionLoading(false);
            }
        }
        fetchSubscription();
    }, [org.org.orgId]);

    useEffect(() => {
        async function fetchUsage() {
            try {
                const res = await api.get<AxiosResponse<GetOrgUsageResponse>>(
                    `/org/${org.org.orgId}/billing/usage`
                );
                const { usage, limits } = res.data.data;

                setUsageData(usage);
                setLimitsData(limits);
            } catch (error) {
                toast({
                    title: t("billingFailedToLoadUsage"),
                    description: formatAxiosError(error),
                    variant: "destructive"
                });
            } finally {
            }
        }
        fetchUsage();
    }, [org.org.orgId]);

    const [hasSubscription, setHasSubscription] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    // const [newPricing, setNewPricing] = useState({
    //     pricePerGB: mockSubscription.pricePerGB,
    //     pricePerMinute: mockSubscription.pricePerMinute,
    // })

    const handleStartSubscription = async () => {
        setIsLoading(true);
        try {
            const response = await api.post<AxiosResponse<string>>(
                `/org/${org.org.orgId}/billing/create-checkout-session`,
                {}
            );
            console.log("Checkout session response:", response.data);
            const checkoutUrl = response.data.data;
            if (checkoutUrl) {
                window.location.href = checkoutUrl;
            } else {
                toast({
                    title: t("billingFailedToGetCheckoutUrl"),
                    description: t("billingPleaseTryAgainLater"),
                    variant: "destructive"
                });
                setIsLoading(false);
            }
        } catch (error) {
            toast({
                title: t("billingCheckoutError"),
                description: formatAxiosError(error),
                variant: "destructive"
            });
            setIsLoading(false);
        }
    };

    const handleModifySubscription = async () => {
        setIsLoading(true);
        try {
            const response = await api.post<AxiosResponse<string>>(
                `/org/${org.org.orgId}/billing/create-portal-session`,
                {}
            );
            const portalUrl = response.data.data;
            if (portalUrl) {
                window.location.href = portalUrl;
            } else {
                toast({
                    title: t("billingFailedToGetPortalUrl"),
                    description: t("billingPleaseTryAgainLater"),
                    variant: "destructive"
                });
                setIsLoading(false);
            }
        } catch (error) {
            toast({
                title: t("billingPortalError"),
                description: formatAxiosError(error),
                variant: "destructive"
            });
            setIsLoading(false);
        }
    };

    // Usage IDs
    const SITE_UPTIME = "siteUptime";
    const USERS = "users";
    const EGRESS_DATA_MB = "egressDataMb";
    const DOMAINS = "domains";
    const REMOTE_EXIT_NODES = "remoteExitNodes";

    // Helper to calculate tiered price
    function calculateTieredPrice(
        usage: number,
        tiersRaw: string | null | undefined
    ) {
        if (!tiersRaw) return 0;
        let tiers: any[] = [];
        try {
            tiers = JSON.parse(tiersRaw);
        } catch {
            return 0;
        }
        let total = 0;
        let remaining = usage;
        for (const tier of tiers) {
            const upTo = tier.up_to === null ? Infinity : Number(tier.up_to);
            const unitAmount =
                tier.unit_amount !== null
                    ? Number(tier.unit_amount / 100)
                    : tier.unit_amount_decimal
                      ? Number(tier.unit_amount_decimal / 100)
                      : 0;
            const tierQty = Math.min(
                remaining,
                upTo === Infinity ? remaining : upTo - (usage - remaining)
            );
            if (tierQty > 0) {
                total += tierQty * unitAmount;
                remaining -= tierQty;
            }
            if (remaining <= 0) break;
        }
        return total;
    }

    function getDisplayPrice(tiersRaw: string | null | undefined) {
        //find the first non-zero tier price
        if (!tiersRaw) return "$0.00";
        let tiers: any[] = [];
        try {
            tiers = JSON.parse(tiersRaw);
        } catch {
            return "$0.00";
        }
        if (tiers.length === 0) return "$0.00";

        // find the first tier with a non-zero price
        const firstTier =
            tiers.find(
                (t) =>
                    t.unit_amount > 0 ||
                    (t.unit_amount_decimal && Number(t.unit_amount_decimal) > 0)
            ) || tiers[0];
        const unitAmount =
            firstTier.unit_amount !== null
                ? Number(firstTier.unit_amount / 100)
                : firstTier.unit_amount_decimal
                  ? Number(firstTier.unit_amount_decimal / 100)
                  : 0;
        return `$${unitAmount.toFixed(4)}`; // ${firstTier.up_to === null ? "per unit" : `per ${firstTier.up_to} units`}`;
    }

    // Helper to get included usage amount from subscription tier
    function getIncludedUsage(tiersRaw: string | null | undefined) {
        if (!tiersRaw) return 0;
        let tiers: any[] = [];
        try {
            tiers = JSON.parse(tiersRaw);
        } catch {
            return 0;
        }
        if (tiers.length === 0) return 0;

        // Find the first tier (which represents included usage)
        const firstTier = tiers[0];
        if (!firstTier) return 0;

        // If the first tier has a unit_amount of 0, it represents included usage
        const isIncludedTier =
            (firstTier.unit_amount === 0 || firstTier.unit_amount === null) &&
            (!firstTier.unit_amount_decimal ||
                Number(firstTier.unit_amount_decimal) === 0);

        if (isIncludedTier && firstTier.up_to !== null) {
            return Number(firstTier.up_to);
        }

        return 0;
    }

    // Helper to get display value for included usage
    function getIncludedUsageDisplay(includedAmount: number, usageType: any) {
        if (includedAmount === 0) return "0";

        if (usageType.id === EGRESS_DATA_MB) {
            // Convert MB to GB for data usage
            return (includedAmount / 1000).toFixed(2);
        }

        if (usageType.id === USERS || usageType.id === DOMAINS) {
            // divide by 32 days
            return (includedAmount / 32).toFixed(2);
        }

        return includedAmount.toString();
    }

    // Helper to get usage, subscription item, and limit by usageId
    function getUsageItemAndLimit(
        usageData: any[],
        subscriptionItems: any[],
        limitsData: any[],
        usageId: string
    ) {
        const usage = usageData.find((u) => u.featureId === usageId);
        if (!usage) return { usage: 0, item: undefined, limit: undefined };
        const item = subscriptionItems.find((i) => i.meterId === usage.meterId);
        const limit = limitsData.find((l) => l.featureId === usageId);
        return { usage: usage ?? 0, item, limit };
    }

    // Helper to check if usage exceeds limit
    function isOverLimit(usage: any, limit: any, usageType: any) {
        if (!limit || !usage) return false;
        const currentUsage = usageType.getLimitUsage(usage);
        return currentUsage > limit.value;
    }

    // Map usage and pricing for each usage type
    const usageTypes = [
        {
            id: EGRESS_DATA_MB,
            label: t("billingDataUsage"),
            icon: <Database className="h-4 w-4 text-blue-500" />,
            unit: "GB",
            unitRaw: "MB",
            info: t("billingDataUsageInfo"),
            note: "Not counted on self-hosted nodes",
            // Convert MB to GB for display and pricing
            getDisplay: (v: any) => (v.latestValue / 1000).toFixed(2),
            getLimitDisplay: (v: any) => (v.value / 1000).toFixed(2),
            getUsage: (v: any) => v.latestValue,
            getLimitUsage: (v: any) => v.latestValue
        },
        {
            id: SITE_UPTIME,
            label: t("billingOnlineTime"),
            icon: <Clock className="h-4 w-4 text-green-500" />,
            unit: "min",
            info: t("billingOnlineTimeInfo"),
            note: "Not counted on self-hosted nodes",
            getDisplay: (v: any) => v.latestValue,
            getLimitDisplay: (v: any) => v.value,
            getUsage: (v: any) => v.latestValue,
            getLimitUsage: (v: any) => v.latestValue
        },
        {
            id: USERS,
            label: t("billingUsers"),
            icon: <Users className="h-4 w-4 text-purple-500" />,
            unit: "",
            unitRaw: "user days",
            info: t("billingUsersInfo"),
            getDisplay: (v: any) => v.instantaneousValue,
            getLimitDisplay: (v: any) => v.value,
            getUsage: (v: any) => v.latestValue,
            getLimitUsage: (v: any) => v.instantaneousValue
        },
        {
            id: DOMAINS,
            label: t("billingDomains"),
            icon: <CreditCard className="h-4 w-4 text-yellow-500" />,
            unit: "",
            unitRaw: "domain days",
            info: t("billingDomainInfo"),
            getDisplay: (v: any) => v.instantaneousValue,
            getLimitDisplay: (v: any) => v.value,
            getUsage: (v: any) => v.latestValue,
            getLimitUsage: (v: any) => v.instantaneousValue
        },
        {
            id: REMOTE_EXIT_NODES,
            label: t("billingRemoteExitNodes"),
            icon: <Server className="h-4 w-4 text-red-500" />,
            unit: "",
            unitRaw: "node days",
            info: t("billingRemoteExitNodesInfo"),
            getDisplay: (v: any) => v.instantaneousValue,
            getLimitDisplay: (v: any) => v.value,
            getUsage: (v: any) => v.latestValue,
            getLimitUsage: (v: any) => v.instantaneousValue
        }
    ];

    if (subscriptionLoading) {
        return (
            <div className="flex justify-center items-center h-64">
                <span>{t("billingLoadingSubscription")}</span>
            </div>
        );
    }

    return (
        <SettingsContainer>
            <div className="flex items-center justify-between mb-6">
                <Badge
                    variant={
                        subscription?.status === "active" ? "green" : "outline"
                    }
                >
                    {subscription?.status === "active" && (
                        <CheckCircle className="h-3 w-3 mr-1" />
                    )}
                    {subscription
                        ? subscription.status.charAt(0).toUpperCase() +
                          subscription.status.slice(1)
                        : t("billingFreeTier")}
                </Badge>
                <Link
                    className="flex items-center gap-2 text-primary hover:underline"
                    href="https://pangolin.net/pricing"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <span>{t("billingPricingCalculatorLink")}</span>
                    <ExternalLink className="h-4 w-4" />
                </Link>
            </div>

            {usageTypes.some((type) => {
                const { usage, limit } = getUsageItemAndLimit(
                    usageData,
                    subscriptionItems,
                    limitsData,
                    type.id
                );
                return isOverLimit(usage, limit, type);
            }) && (
                <Alert className="border-destructive/50 bg-destructive/10 mb-6">
                    <AlertCircle className="h-4 w-4 text-destructive" />
                    <AlertDescription className="text-destructive">
                        {t("billingWarningOverLimit")}
                    </AlertDescription>
                </Alert>
            )}

            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("billingUsageLimitsOverview")}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("billingMonitorUsage")}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>
                <SettingsSectionBody>
                    <div className="space-y-4">
                        {usageTypes.map((type) => {
                            const { usage, limit } = getUsageItemAndLimit(
                                usageData,
                                subscriptionItems,
                                limitsData,
                                type.id
                            );
                            const displayUsage = type.getDisplay(usage);
                            const usageForPricing = type.getLimitUsage(usage);
                            const overLimit = isOverLimit(usage, limit, type);
                            const percentage = limit
                                ? Math.min(
                                      (usageForPricing / limit.value) * 100,
                                      100
                                  )
                                : 0;

                            return (
                                <div key={type.id} className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            {type.icon}
                                            <span className="font-medium">
                                                {type.label}
                                            </span>
                                            <InfoPopup info={type.info} />
                                        </div>
                                        <div className="text-right">
                                            <span
                                                className={`font-bold ${overLimit ? "text-red-600" : ""}`}
                                            >
                                                {displayUsage} {type.unit}
                                            </span>
                                            {limit && (
                                                <span className="text-muted-foreground">
                                                    {" "}
                                                    /{" "}
                                                    {type.getLimitDisplay(
                                                        limit
                                                    )}{" "}
                                                    {type.unit}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    {type.note && (
                                        <div className="text-xs text-muted-foreground mt-1">
                                            {type.note}
                                        </div>
                                    )}
                                    {limit && (
                                        <Progress
                                            value={Math.min(percentage, 100)}
                                            variant={
                                                overLimit
                                                    ? "danger"
                                                    : percentage > 80
                                                      ? "warning"
                                                      : "success"
                                            }
                                        />
                                    )}
                                    {!limit && (
                                        <p className="text-sm text-muted-foreground">
                                            {t("billingNoLimitConfigured")}
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </SettingsSectionBody>
            </SettingsSection>

            {(hasSubscription ||
                (!hasSubscription && limitsData.length > 0)) && (
                <SettingsSection>
                    <SettingsSectionHeader>
                        <SettingsSectionTitle>
                            {t("billingIncludedUsage")}
                        </SettingsSectionTitle>
                        <SettingsSectionDescription>
                            {hasSubscription
                                ? t("billingIncludedUsageDescription")
                                : t("billingFreeTierIncludedUsage")}
                        </SettingsSectionDescription>
                    </SettingsSectionHeader>
                    <SettingsSectionBody>
                        <div className="grid gap-4 md:grid-cols-2">
                            {usageTypes.map((type) => {
                                const { item, limit } = getUsageItemAndLimit(
                                    usageData,
                                    subscriptionItems,
                                    limitsData,
                                    type.id
                                );

                                // For subscribed users, show included usage from tiers
                                // For free users, show the limit as "included"
                                let includedAmount = 0;
                                let displayIncluded = "0";

                                if (hasSubscription && item) {
                                    includedAmount = getIncludedUsage(
                                        item.tiers
                                    );
                                    displayIncluded = getIncludedUsageDisplay(
                                        includedAmount,
                                        type
                                    );
                                } else if (
                                    !hasSubscription &&
                                    limit &&
                                    limit.value > 0
                                ) {
                                    // Show free tier limits as "included"
                                    includedAmount = limit.value;
                                    displayIncluded =
                                        type.getLimitDisplay(limit);
                                }

                                if (includedAmount === 0) return null;

                                return (
                                    <div
                                        key={type.id}
                                        className="flex items-center justify-between p-3 border rounded-lg bg-muted/30"
                                    >
                                        <div className="flex items-center gap-2">
                                            {type.icon}
                                            <span className="font-medium">
                                                {type.label}
                                            </span>
                                        </div>
                                        <div className="text-right">
                                            <div className="flex items-center gap-1 justify-end">
                                                {hasSubscription ? (
                                                    <CheckCircle className="h-3 w-3 text-green-600" />
                                                ) : (
                                                    <Gift className="h-3 w-3 text-blue-600" />
                                                )}
                                                <span
                                                    className={`font-semibold ${hasSubscription ? "text-green-600" : "text-blue-600"}`}
                                                >
                                                    {displayIncluded}{" "}
                                                    {type.unit}
                                                </span>
                                            </div>
                                            <div className="text-xs text-muted-foreground">
                                                {hasSubscription
                                                    ? t("billingIncluded")
                                                    : t("billingFreeTier")}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </SettingsSectionBody>
                </SettingsSection>
            )}

            {hasSubscription && (
                <SettingsSection>
                    <SettingsSectionHeader>
                        <SettingsSectionTitle>
                            {t("billingEstimatedPeriod")}
                        </SettingsSectionTitle>
                    </SettingsSectionHeader>
                    <SettingsSectionBody>
                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                {usageTypes.map((type) => {
                                    const { usage, item } =
                                        getUsageItemAndLimit(
                                            usageData,
                                            subscriptionItems,
                                            limitsData,
                                            type.id
                                        );
                                    const displayPrice = getDisplayPrice(
                                        item?.tiers
                                    );
                                    return (
                                        <div
                                            className="flex justify-between"
                                            key={type.id}
                                        >
                                            <span>{type.label}:</span>
                                            <span>
                                                {type.getUsage(usage)}{" "}
                                                {type.unitRaw || type.unit} x{" "}
                                                {displayPrice}
                                            </span>
                                        </div>
                                    );
                                })}
                                {/* Show recurring charges (items with unitAmount but no tiers/meterId) */}
                                {subscriptionItems
                                    .filter(
                                        (item) =>
                                            item.unitAmount &&
                                            item.unitAmount > 0 &&
                                            !item.tiers &&
                                            !item.meterId
                                    )
                                    .map((item, index) => (
                                        <div
                                            className="flex justify-between"
                                            key={`recurring-${item.subscriptionItemId || index}`}
                                        >
                                            <span>
                                                {item.name ||
                                                    t("billingRecurringCharge")}
                                                :
                                            </span>
                                            <span>
                                                $
                                                {(
                                                    (item.unitAmount || 0) / 100
                                                ).toFixed(2)}
                                            </span>
                                        </div>
                                    ))}
                                <Separator />
                                <div className="flex justify-between font-semibold">
                                    <span>{t("billingEstimatedTotal")}</span>
                                    <span>
                                        $
                                        {(
                                            usageTypes.reduce((sum, type) => {
                                                const { usage, item } =
                                                    getUsageItemAndLimit(
                                                        usageData,
                                                        subscriptionItems,
                                                        limitsData,
                                                        type.id
                                                    );
                                                const usageForPricing =
                                                    type.getUsage(usage);
                                                const cost = item
                                                    ? calculateTieredPrice(
                                                          usageForPricing,
                                                          item.tiers
                                                      )
                                                    : 0;
                                                return sum + cost;
                                            }, 0) +
                                            // Add recurring charges
                                            subscriptionItems
                                                .filter(
                                                    (item) =>
                                                        item.unitAmount &&
                                                        item.unitAmount > 0 &&
                                                        !item.tiers &&
                                                        !item.meterId
                                                )
                                                .reduce(
                                                    (sum, item) =>
                                                        sum +
                                                        (item.unitAmount || 0) /
                                                            100,
                                                    0
                                                )
                                        ).toFixed(2)}
                                    </span>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <h4 className="font-medium">
                                    {t("billingNotes")}
                                </h4>
                                <div className="text-sm text-muted-foreground space-y-1">
                                    <p>{t("billingEstimateNote")}</p>
                                    <p>{t("billingActualChargesMayVary")}</p>
                                    <p>{t("billingBilledAtEnd")}</p>
                                </div>
                            </div>
                        </div>

                        <SettingsSectionFooter>
                            <Button
                                variant="secondary"
                                onClick={() => handleModifySubscription()}
                                disabled={isLoading}
                            >
                                {t("billingModifySubscription")}
                            </Button>
                        </SettingsSectionFooter>
                    </SettingsSectionBody>
                </SettingsSection>
            )}

            {!hasSubscription && (
                <SettingsSection>
                    <SettingsSectionBody>
                        <div className="text-center py-8">
                            <CreditCard className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                            <p className="text-muted-foreground mb-4">
                                {t("billingNoActiveSubscription")}
                            </p>
                            <Button
                                onClick={() => handleStartSubscription()}
                                disabled={isLoading}
                            >
                                {t("billingStartSubscription")}
                            </Button>
                        </div>
                    </SettingsSectionBody>
                </SettingsSection>
            )}
        </SettingsContainer>
    );
}
