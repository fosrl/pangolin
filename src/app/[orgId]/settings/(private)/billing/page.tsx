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
    SettingsFormCell,
    SettingsFormGrid,
    SettingsSection,
    SettingsSectionHeader,
    SettingsSectionTitle,
    SettingsSectionDescription,
    SettingsSectionBody,
    SettingsSectionFooter,
    SettingsSectionForm
} from "@app/components/Settings";
import {
    InfoSection,
    InfoSectionContent,
    InfoSections,
    InfoSectionTitle
} from "@app/components/InfoSection";
import {
    Credenza,
    CredenzaBody,
    CredenzaClose,
    CredenzaContent,
    CredenzaDescription,
    CredenzaFooter,
    CredenzaHeader,
    CredenzaTitle
} from "@app/components/Credenza";
import { cn } from "@app/lib/cn";
import { CreditCard, ExternalLink, Check, AlertTriangle } from "lucide-react";
import { Badge } from "@app/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@app/components/ui/alert";
import {
    Tooltip,
    TooltipTrigger,
    TooltipContent
} from "@app/components/ui/tooltip";
import {
    GetOrgSubscriptionResponse,
    GetOrgUsageResponse
} from "@server/routers/billing/types";
import { useTranslations } from "use-intl";
import Link from "next/link";
import { Tier } from "@server/types/Tiers";
import {
    freeLimitSet,
    tier1LimitSet,
    tier2LimitSet,
    tier3LimitSet
} from "@server/lib/billing/limitSet";
import { LimitId } from "@server/lib/billing/features";
import TrialBillingBanner from "@app/components/TrialBillingBanner";

// Plan tier definitions matching the mockup
type PlanId = "basic" | "home" | "team" | "business" | "enterprise";

type PlanOption = {
    id: PlanId;
    name: string;
    price: string;
    priceDetail?: string;
    tierType: Tier | null;
    features: string[];
};

const planOptions: PlanOption[] = [
    {
        id: "basic",
        name: "Basic",
        price: "Free",
        tierType: null,
        features: [
            "Basic Pangolin features",
            "Free provided domains",
            "Web-based proxy resources",
            "Private resources and clients",
            "Peer-to-peer connections"
        ]
    },
    {
        id: "home",
        name: "Home",
        price: "$12.50",
        priceDetail: "/ month",
        tierType: "tier1",
        features: [
            "Everything in Basic",
            "OAuth2/OIDC, Google, & Azure SSO",
            "Bring your own identity provider",
            "Pangolin SSH",
            "Custom branding",
            "Device admin approvals"
        ]
    },
    {
        id: "team",
        name: "Team",
        price: "$4",
        priceDetail: "per user / month",
        tierType: "tier2",
        features: [
            "Everything in Basic",
            "Custom domains",
            "OAuth2/OIDC, Google, & Azure SSO",
            "Access and action audit logs",
            "Device posture information"
        ]
    },
    {
        id: "business",
        name: "Business",
        price: "$9",
        priceDetail: "per user / month",
        tierType: "tier3",
        features: [
            "Everything in Team",
            "Multiple organizations (multi-tenancy)",
            "Auto-provisioning via IdP",
            "Pangolin SSH",
            "Device approvals",
            "Custom branding",
            "Business support"
        ]
    },
    {
        id: "enterprise",
        name: "Enterprise",
        price: "Custom",
        tierType: null,
        features: [
            "Everything in Business",
            "Custom limits",
            "Priority support and SLA",
            "Log push and export",
            "Private and Gov-Cloud deployment options",
            "Dedicated, premium relay/exit nodes",
            "Pay by invoice "
        ]
    }
];

// Tier limits mapping derived from limit sets
const tierLimits: Record<
    Tier | "basic",
    {
        users: number;
        sites: number;
        domains: number;
        remoteNodes: number;
        organizations: number;
        publicResources: number;
        privateResources: number;
        machineClients: number;
    }
> = {
    basic: {
        users: freeLimitSet[LimitId.USERS]?.value ?? 0,
        sites: freeLimitSet[LimitId.SITES]?.value ?? 0,
        domains: freeLimitSet[LimitId.DOMAINS]?.value ?? 0,
        remoteNodes: freeLimitSet[LimitId.REMOTE_EXIT_NODES]?.value ?? 0,
        organizations: freeLimitSet[LimitId.ORGANIZATIONS]?.value ?? 0,
        publicResources: freeLimitSet[LimitId.PUBLIC_RESOURCES]?.value ?? 0,
        privateResources: freeLimitSet[LimitId.PRIVATE_RESOURCES]?.value ?? 0,
        machineClients: freeLimitSet[LimitId.MACHINE_CLIENTS]?.value ?? 0
    },
    tier1: {
        users: tier1LimitSet[LimitId.USERS]?.value ?? 0,
        sites: tier1LimitSet[LimitId.SITES]?.value ?? 0,
        domains: tier1LimitSet[LimitId.DOMAINS]?.value ?? 0,
        remoteNodes: tier1LimitSet[LimitId.REMOTE_EXIT_NODES]?.value ?? 0,
        organizations: tier1LimitSet[LimitId.ORGANIZATIONS]?.value ?? 0,
        publicResources: tier1LimitSet[LimitId.PUBLIC_RESOURCES]?.value ?? 0,
        privateResources: tier1LimitSet[LimitId.PRIVATE_RESOURCES]?.value ?? 0,
        machineClients: tier1LimitSet[LimitId.MACHINE_CLIENTS]?.value ?? 0
    },
    tier2: {
        users: tier2LimitSet[LimitId.USERS]?.value ?? 0,
        sites: tier2LimitSet[LimitId.SITES]?.value ?? 0,
        domains: tier2LimitSet[LimitId.DOMAINS]?.value ?? 0,
        remoteNodes: tier2LimitSet[LimitId.REMOTE_EXIT_NODES]?.value ?? 0,
        organizations: tier2LimitSet[LimitId.ORGANIZATIONS]?.value ?? 0,
        publicResources: tier2LimitSet[LimitId.PUBLIC_RESOURCES]?.value ?? 0,
        privateResources: tier2LimitSet[LimitId.PRIVATE_RESOURCES]?.value ?? 0,
        machineClients: tier2LimitSet[LimitId.MACHINE_CLIENTS]?.value ?? 0
    },
    tier3: {
        users: tier3LimitSet[LimitId.USERS]?.value ?? 0,
        sites: tier3LimitSet[LimitId.SITES]?.value ?? 0,
        domains: tier3LimitSet[LimitId.DOMAINS]?.value ?? 0,
        remoteNodes: tier3LimitSet[LimitId.REMOTE_EXIT_NODES]?.value ?? 0,
        organizations: tier3LimitSet[LimitId.ORGANIZATIONS]?.value ?? 0,
        publicResources: tier3LimitSet[LimitId.PUBLIC_RESOURCES]?.value ?? 0,
        privateResources: tier3LimitSet[LimitId.PRIVATE_RESOURCES]?.value ?? 0,
        machineClients: tier3LimitSet[LimitId.MACHINE_CLIENTS]?.value ?? 0
    },
    enterprise: {
        users: 0, // Custom for enterprise
        sites: 0, // Custom for enterprise
        domains: 0, // Custom for enterprise
        remoteNodes: 0, // Custom for enterprise
        organizations: 0, // Custom for enterprise
        publicResources: 0, // Custom for enterprise
        privateResources: 0, // Custom for enterprise
        machineClients: 0 // Custom for enterprise
    }
};

export default function BillingPage() {
    const { org } = useOrgContext();
    const envContext = useEnvContext();
    const api = createApiClient(envContext);
    const t = useTranslations();

    // Subscription state
    const [allSubscriptions, setAllSubscriptions] = useState<
        GetOrgSubscriptionResponse["subscriptions"]
    >([]);
    const [tierSubscription, setTierSubscription] = useState<
        GetOrgSubscriptionResponse["subscriptions"][0] | null
    >(null);
    const [licenseSubscription, setLicenseSubscription] = useState<
        GetOrgSubscriptionResponse["subscriptions"][0] | null
    >(null);
    const [subscriptionLoading, setSubscriptionLoading] = useState(true);

    // Usage and limits data
    const [usageData, setUsageData] = useState<GetOrgUsageResponse["usage"]>(
        []
    );
    const [limitsData, setLimitsData] = useState<GetOrgUsageResponse["limits"]>(
        []
    );

    const [hasSubscription, setHasSubscription] = useState(false);
    const [isTrial, setIsTrial] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [currentTier, setCurrentTier] = useState<Tier | null>(null);

    // Usage IDs
    const USERS = "users";
    const SITES = "sites";
    const DOMAINS = "domains";
    const REMOTE_EXIT_NODES = "remoteExitNodes";
    const ORGINIZATIONS = "organizations";
    const PUBLIC_RESOURCES = "publicResources";
    const PRIVATE_RESOURCES = "privateResources";
    const MACHINE_CLIENTS = "machineClients";

    // Confirmation dialog state
    const [showConfirmDialog, setShowConfirmDialog] = useState(false);
    const [pendingTier, setPendingTier] = useState<{
        tier: Tier | "basic";
        action: "upgrade" | "downgrade";
        planName: string;
        price: string;
    } | null>(null);

    useEffect(() => {
        async function fetchSubscription() {
            setSubscriptionLoading(true);
            try {
                const res = await api.get<
                    AxiosResponse<GetOrgSubscriptionResponse>
                >(`/org/${org.org.orgId}/billing/subscriptions`);
                const { subscriptions } = res.data.data;
                setAllSubscriptions(subscriptions);

                // Find tier subscription
                const tierSub = subscriptions.find(
                    ({ subscription }) =>
                        subscription?.type === "tier1" ||
                        subscription?.type === "tier2" ||
                        subscription?.type === "tier3" ||
                        subscription?.type === "enterprise"
                );
                setTierSubscription(tierSub || null);

                if (tierSub?.subscription) {
                    setCurrentTier(tierSub.subscription.type as Tier);
                    setHasSubscription(
                        tierSub.subscription.status === "active"
                    );
                    // expiresAt is only meaningful while the trial hasn't
                    // actually run out yet; a stale row with a past
                    // expiresAt should no longer be treated as a live trial
                    const expiresAt = tierSub.subscription.expiresAt;
                    setIsTrial(
                        expiresAt != null && expiresAt * 1000 > Date.now()
                    );
                }

                // Find license subscription
                const licenseSub = subscriptions.find(
                    ({ subscription }) => subscription?.type === "license"
                );
                setLicenseSubscription(licenseSub || null);
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
            }
        }
        fetchUsage();
    }, [org.org.orgId]);

    const handleStartSubscription = async (tier: Tier) => {
        setIsLoading(true);
        try {
            const response = await api.post<AxiosResponse<string>>(
                `/org/${org.org.orgId}/billing/create-checkout-session`,
                { tier }
            );
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

    const handleChangeTier = async (tier: Tier) => {
        if (!hasSubscription) {
            // If no subscription, start a new one
            handleStartSubscription(tier);
            return;
        }

        setIsLoading(true);
        try {
            await api.post(`/org/${org.org.orgId}/billing/change-tier`, {
                tier
            });

            // Poll the API to check if the tier change has been reflected
            const pollForTierChange = async (targetTier: Tier) => {
                const maxAttempts = 30; // 30 seconds with 1 second interval
                let attempts = 0;

                const poll = async (): Promise<boolean> => {
                    try {
                        const res = await api.get<
                            AxiosResponse<GetOrgSubscriptionResponse>
                        >(`/org/${org.org.orgId}/billing/subscriptions`);
                        const { subscriptions } = res.data.data;

                        // Find tier subscription
                        const tierSub = subscriptions.find(
                            ({ subscription }) =>
                                subscription?.type === "tier1" ||
                                subscription?.type === "tier2" ||
                                subscription?.type === "tier3"
                        );

                        // Check if the tier has changed to the target tier
                        if (tierSub?.subscription?.type === targetTier) {
                            return true;
                        }

                        return false;
                    } catch (error) {
                        console.error("Error polling subscription:", error);
                        return false;
                    }
                };

                while (attempts < maxAttempts) {
                    const success = await poll();

                    if (success) {
                        // Tier change reflected, refresh the page
                        window.location.reload();
                        return;
                    }

                    attempts++;

                    if (attempts < maxAttempts) {
                        // Wait 1 second before next poll
                        await new Promise((resolve) =>
                            setTimeout(resolve, 1000)
                        );
                    }
                }

                // If we've exhausted all attempts, show an error
                toast({
                    title: "Tier change processing",
                    description:
                        "Your tier change is taking longer than expected. Please refresh the page in a moment to see the changes.",
                    variant: "destructive"
                });
                setIsLoading(false);
            };

            // Start polling for the tier change
            pollForTierChange(tier);
        } catch (error) {
            toast({
                title: "Failed to change tier",
                description: formatAxiosError(error),
                variant: "destructive"
            });
            setIsLoading(false);
        }
    };

    const confirmTierChange = () => {
        if (!pendingTier) return;

        if (
            pendingTier.action === "upgrade" ||
            pendingTier.action === "downgrade"
        ) {
            // If downgrading to basic (free tier), go to Stripe portal
            if (pendingTier.tier === "basic") {
                handleModifySubscription();
            } else if (hasSubscription) {
                handleChangeTier(pendingTier.tier);
            } else {
                handleStartSubscription(pendingTier.tier);
            }
        }

        // setShowConfirmDialog(false);
        // setPendingTier(null);
    };

    const showTierConfirmation = (
        tier: Tier | "basic",
        action: "upgrade" | "downgrade",
        planName: string,
        price: string
    ) => {
        setPendingTier({ tier, action, planName, price });
        setShowConfirmDialog(true);
    };

    const handleContactUs = () => {
        window.open("https://pangolin.net/contact", "_blank");
    };

    // Get current plan ID from tier
    const getCurrentPlanId = (): PlanId => {
        if (!hasSubscription || !currentTier) return "basic";
        // Handle enterprise subscription type directly
        if (currentTier === "enterprise") return "enterprise";
        const plan = planOptions.find((p) => p.tierType === currentTier);
        return plan?.id || "basic";
    };

    const currentPlanId = getCurrentPlanId();

    const visiblePlanOptions = planOptions.filter(
        (plan) => plan.id !== "home" || currentPlanId === "home"
    );

    // Check if subscription is in a problematic state that requires attention
    const hasProblematicSubscription = (): boolean => {
        if (!tierSubscription?.subscription) return false;
        const status = tierSubscription.subscription.status;
        return (
            status === "past_due" ||
            status === "unpaid" ||
            status === "incomplete" ||
            status === "incomplete_expired"
        );
    };

    const isProblematicState = hasProblematicSubscription();

    // Get user-friendly subscription status message
    const getSubscriptionStatusMessage = (): {
        title: string;
        description: string;
    } | null => {
        if (!tierSubscription?.subscription || !isProblematicState) return null;

        const status = tierSubscription.subscription.status;

        switch (status) {
            case "past_due":
                return {
                    title: t("billingPastDueTitle") || "Payment Past Due",
                    description:
                        t("billingPastDueDescription") ||
                        "Your payment is past due. Please update your payment method to continue using your current plan features. If not resolved, your subscription will be canceled and you'll be reverted to the free tier."
                };
            case "unpaid":
                return {
                    title: t("billingUnpaidTitle") || "Subscription Unpaid",
                    description:
                        t("billingUnpaidDescription") ||
                        "Your subscription is unpaid and you have been reverted to the free tier. Please update your payment method to restore your subscription."
                };
            case "incomplete":
                return {
                    title: t("billingIncompleteTitle") || "Payment Incomplete",
                    description:
                        t("billingIncompleteDescription") ||
                        "Your payment is incomplete. Please complete the payment process to activate your subscription."
                };
            case "incomplete_expired":
                return {
                    title:
                        t("billingIncompleteExpiredTitle") || "Payment Expired",
                    description:
                        t("billingIncompleteExpiredDescription") ||
                        "Your payment was never completed and has expired. You have been reverted to the free tier. Please subscribe again to restore access to paid features."
                };
            default:
                return null;
        }
    };

    const statusMessage = getSubscriptionStatusMessage();

    // Get button label and action for each plan
    const getPlanAction = (plan: PlanOption) => {
        if (plan.id === "enterprise") {
            if (plan.id === currentPlanId && !isTrial) {
                return {
                    label: "Manage Current Plan",
                    action: handleModifySubscription,
                    variant: "default" as const,
                    disabled: false
                };
            }
            return {
                label: "Contact Us",
                action: handleContactUs,
                variant: "outline" as const,
                disabled: false
            };
        }

        if (plan.id === currentPlanId) {
            // If it's the basic plan (basic with no subscription), show as current but disabled
            if (
                plan.id === "basic" &&
                !hasSubscription &&
                !isProblematicState
            ) {
                return {
                    label: "Current Plan",
                    action: () => {},
                    variant: "default" as const,
                    disabled: true
                };
            }
            // If on free tier but has a problematic subscription, allow them to manage it
            if (plan.id === "basic" && isProblematicState) {
                return {
                    label: "Manage Subscription",
                    action: handleModifySubscription,
                    variant: "default" as const,
                    disabled: false
                };
            }
            // If this is a trial subscription, show an upgrade button that starts a real checkout
            if (isTrial) {
                return {
                    label: "Upgrade",
                    action: () => {
                        if (plan.tierType) {
                            handleStartSubscription(plan.tierType);
                        }
                    },
                    variant: "default" as const,
                    disabled: isProblematicState
                };
            }
            return {
                label: "Manage Current Plan",
                action: handleModifySubscription,
                variant: "default" as const,
                disabled: false
            };
        }

        const currentIndex = planOptions.findIndex(
            (p) => p.id === currentPlanId
        );
        const planIndex = planOptions.findIndex((p) => p.id === plan.id);

        // During a trial, never show a downgrade option — all non-current plans are upgrades
        if (!isTrial && planIndex < currentIndex) {
            return {
                label: "Downgrade",
                action: () => {
                    if (plan.tierType) {
                        showTierConfirmation(
                            plan.tierType,
                            "downgrade",
                            plan.name,
                            plan.price + (" " + plan.priceDetail || "")
                        );
                    } else if (plan.id === "basic") {
                        // Show confirmation for downgrading to basic (free tier)
                        showTierConfirmation(
                            "basic",
                            "downgrade",
                            plan.name,
                            plan.price
                        );
                    } else {
                        handleModifySubscription();
                    }
                },
                variant: "outline" as const,
                disabled: isProblematicState
            };
        }

        return {
            label: "Upgrade",
            action: () => {
                if (plan.tierType) {
                    // During a trial, go straight to checkout instead of the tier-change flow
                    if (isTrial) {
                        handleStartSubscription(plan.tierType);
                    } else {
                        showTierConfirmation(
                            plan.tierType,
                            "upgrade",
                            plan.name,
                            plan.price + (" " + plan.priceDetail || "")
                        );
                    }
                } else {
                    handleModifySubscription();
                }
            },
            variant: "outline" as const,
            disabled: isProblematicState || (isTrial && plan.id == "basic")
        };
    };

    // Get usage value by feature ID
    const getUsageValue = (featureId: string): number => {
        const usage = usageData.find((u) => u.featureId === featureId);
        return usage?.instantaneousValue || usage?.latestValue || 0;
    };

    // Get limit value by feature ID
    const getLimitValue = (featureId: string): number | null => {
        const limit = limitsData.find((l) => l.featureId === featureId);
        return limit?.value ?? null;
    };

    // Check if usage exceeds limit for a specific feature
    const isOverLimit = (featureId: string): boolean => {
        const usage = getUsageValue(featureId);
        const limit = getLimitValue(featureId);
        return limit !== null && usage > limit;
    };

    // Calculate current usage cost for display
    const getUserCount = () => getUsageValue(USERS);
    const getPricePerUser = () => {
        if (!tierSubscription?.items) return 0;

        // Find the subscription item for USERS feature
        const usersItem = tierSubscription.items.find(
            (item) => item.featureId === USERS
        );

        console.log("Users subscription item:", usersItem);

        // unitAmount is in cents, convert to dollars
        if (usersItem?.unitAmount) {
            return usersItem.unitAmount / 100;
        }

        return 0;
    };

    // Get license key count
    const getLicenseKeyCount = (): number => {
        if (!licenseSubscription?.items) return 0;
        return licenseSubscription.items.length;
    };

    // Check if downgrading to a tier would violate current usage limits
    const checkLimitViolations = (
        targetTier: Tier | "basic"
    ): Array<{
        feature: string;
        currentUsage: number;
        newLimit: number;
    }> => {
        const violations: Array<{
            feature: string;
            currentUsage: number;
            newLimit: number;
        }> = [];

        const limits = tierLimits[targetTier];

        // Check users
        const usersUsage = getUsageValue(USERS);
        if (limits.users > 0 && usersUsage > limits.users) {
            violations.push({
                feature: "Users",
                currentUsage: usersUsage,
                newLimit: limits.users
            });
        }

        // Check sites
        const sitesUsage = getUsageValue(SITES);
        if (limits.sites > 0 && sitesUsage > limits.sites) {
            violations.push({
                feature: "Sites",
                currentUsage: sitesUsage,
                newLimit: limits.sites
            });
        }

        // Check domains
        const domainsUsage = getUsageValue(DOMAINS);
        if (limits.domains > 0 && domainsUsage > limits.domains) {
            violations.push({
                feature: "Domains",
                currentUsage: domainsUsage,
                newLimit: limits.domains
            });
        }

        // Check remote nodes
        const remoteNodesUsage = getUsageValue(REMOTE_EXIT_NODES);
        if (limits.remoteNodes > 0 && remoteNodesUsage > limits.remoteNodes) {
            violations.push({
                feature: "Remote Exit Nodes",
                currentUsage: remoteNodesUsage,
                newLimit: limits.remoteNodes
            });
        }

        // Check organizations
        const organizationsUsage = getUsageValue(ORGINIZATIONS);
        if (
            limits.organizations > 0 &&
            organizationsUsage > limits.organizations
        ) {
            violations.push({
                feature: "Organizations",
                currentUsage: organizationsUsage,
                newLimit: limits.organizations
            });
        }

        // Check public resources
        const publicResourcesUsage = getUsageValue(PUBLIC_RESOURCES);
        if (
            limits.publicResources > 0 &&
            publicResourcesUsage > limits.publicResources
        ) {
            violations.push({
                feature: "Public Resources",
                currentUsage: publicResourcesUsage,
                newLimit: limits.publicResources
            });
        }

        // Check private resources
        const privateResourcesUsage = getUsageValue(PRIVATE_RESOURCES);
        if (
            limits.privateResources > 0 &&
            privateResourcesUsage > limits.privateResources
        ) {
            violations.push({
                feature: "Private Resources",
                currentUsage: privateResourcesUsage,
                newLimit: limits.privateResources
            });
        }

        // Check machine clients
        const machineClientsUsage = getUsageValue(MACHINE_CLIENTS);
        if (
            limits.machineClients > 0 &&
            machineClientsUsage > limits.machineClients
        ) {
            violations.push({
                feature: "Machine Clients",
                currentUsage: machineClientsUsage,
                newLimit: limits.machineClients
            });
        }

        return violations;
    };

    if (subscriptionLoading) {
        return (
            <div className="flex justify-center items-center h-64">
                <span>{t("billingLoadingSubscription")}</span>
            </div>
        );
    }

    return (
        <SettingsContainer>
            {/* Trial Banner */}
            {isTrial && (
                <TrialBillingBanner
                    onUpgrade={() => {
                        const currentPlan = planOptions.find(
                            (p) => p.id === currentPlanId
                        );
                        if (currentPlan?.tierType) {
                            handleStartSubscription(currentPlan.tierType);
                        }
                    }}
                />
            )}

            {/* Subscription Status Alert */}
            {isProblematicState && statusMessage && (
                <Alert variant="destructive" className="mb-6">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>{statusMessage.title}</AlertTitle>
                    <AlertDescription>
                        {statusMessage.description}{" "}
                        <button
                            onClick={handleModifySubscription}
                            className="underline font-semibold hover:no-underline"
                        >
                            {t("billingManageSubscription") ||
                                "Manage your subscription"}
                        </button>
                    </AlertDescription>
                </Alert>
            )}

            {/* Your Plan Section */}
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("billingYourPlan") || "Your Plan"}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("billingViewOrModifyPlan") ||
                            "View or modify your current plan"}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>
                <SettingsSectionBody>
                    {/* Plan Cards Grid */}
                    <div
                        className={cn(
                            "grid grid-cols-1 gap-4",
                            visiblePlanOptions.length === 5
                                ? "md:grid-cols-5"
                                : "md:grid-cols-4"
                        )}
                    >
                        {visiblePlanOptions.map((plan) => {
                            const isCurrentPlan = plan.id === currentPlanId;
                            const planAction = getPlanAction(plan);

                            return (
                                <div
                                    key={plan.id}
                                    className={cn(
                                        "relative flex flex-col rounded-lg border p-4 transition-colors",
                                        isCurrentPlan
                                            ? "border-primary bg-primary/10"
                                            : "border-input hover:bg-accent/50"
                                    )}
                                >
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-2xl">
                                                {plan.name}
                                            </span>
                                            {isCurrentPlan && isTrial && (
                                                <Badge
                                                    variant="outlinePrimary"
                                                    className="text-xs"
                                                >
                                                    {t("billingTrialBadge") ||
                                                        "Free Trial"}
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="mt-1">
                                            <span className="text-xl">
                                                {plan.price}
                                            </span>
                                            {plan.priceDetail && (
                                                <span className="text-sm text-muted-foreground ml-1">
                                                    {plan.priceDetail}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="mt-4">
                                        {isProblematicState &&
                                        planAction.disabled &&
                                        !isCurrentPlan &&
                                        plan.id !== "enterprise" ? (
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <div>
                                                        <Button
                                                            variant={
                                                                isCurrentPlan
                                                                    ? "default"
                                                                    : "outline"
                                                            }
                                                            size="sm"
                                                            className="w-full"
                                                            onClick={
                                                                planAction.action
                                                            }
                                                            disabled={
                                                                isLoading ||
                                                                planAction.disabled
                                                            }
                                                            loading={
                                                                isLoading &&
                                                                isCurrentPlan
                                                            }
                                                        >
                                                            {planAction.label}
                                                        </Button>
                                                    </div>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p>
                                                        {t(
                                                            "billingResolvePaymentIssue"
                                                        ) ||
                                                            "Please resolve your payment issue before upgrading or downgrading"}
                                                    </p>
                                                </TooltipContent>
                                            </Tooltip>
                                        ) : (
                                            <Button
                                                variant={
                                                    isCurrentPlan
                                                        ? "default"
                                                        : "outline"
                                                }
                                                size="sm"
                                                className="w-full"
                                                onClick={planAction.action}
                                                disabled={
                                                    isLoading ||
                                                    planAction.disabled
                                                }
                                                loading={
                                                    isLoading && isCurrentPlan
                                                }
                                            >
                                                {planAction.label}
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </SettingsSectionBody>
                <SettingsSectionFooter>
                    <Link
                        href="https://pangolin.net/pricing"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <Button variant="outline">
                            {t("billingViewPlanDetails") || "View Plan Details"}
                            <ExternalLink className="ml-2 h-4 w-4" />
                        </Button>
                    </Link>
                </SettingsSectionFooter>
            </SettingsSection>

            {/* Usage and Limits Section */}
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("billingUsageAndLimits") || "Usage and Limits"}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("billingViewUsageAndLimits") ||
                            "View your plan's limits and current usage"}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>
                <SettingsSectionBody>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        {/* Current Usage */}
                        <div className="border rounded-lg p-4 md:col-span-1">
                            <div className="text-sm text-muted-foreground mb-2">
                                {t("billingCurrentUsage") || "Current Usage"}
                            </div>
                            <div className="flex flex-col items-start gap-1">
                                <div className="flex items-baseline gap-2">
                                    <span className="text-3xl font-semibold">
                                        {getUserCount()}
                                    </span>
                                    <span className="text-lg">
                                        {t("billingUsers") || "Users"}
                                    </span>
                                </div>
                                {hasSubscription && getPricePerUser() > 0 && (
                                    <div className="text-sm text-muted-foreground">
                                        x ${getPricePerUser()} / month = $
                                        {getUserCount() * getPricePerUser()} /
                                        month
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Maximum Limits */}
                        <div className="border rounded-lg p-4 md:col-span-3">
                            <div className="text-sm text-muted-foreground mb-3">
                                {t("billingMaximumLimits") || "Maximum Limits"}
                            </div>
                            <InfoSections cols={8}>
                                <InfoSection>
                                    <InfoSectionTitle className="flex items-center gap-1 text-xs">
                                        {t("billingUsers") || "Users"}
                                    </InfoSectionTitle>
                                    <InfoSectionContent className="text-sm">
                                        {isOverLimit(USERS) ? (
                                            <Tooltip>
                                                <TooltipTrigger className="flex items-center gap-1">
                                                    <AlertTriangle className="h-3 w-3 text-orange-400" />
                                                    <span
                                                        className={cn(
                                                            "text-orange-600 dark:text-orange-400 font-medium"
                                                        )}
                                                    >
                                                        {getLimitValue(USERS) ??
                                                            t(
                                                                "billingUnlimited"
                                                            ) ??
                                                            "∞"}{" "}
                                                        {getLimitValue(
                                                            USERS
                                                        ) !== null && "users"}
                                                    </span>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p>
                                                        {t(
                                                            "billingUsageExceedsLimit",
                                                            {
                                                                current:
                                                                    getUsageValue(
                                                                        USERS
                                                                    ),
                                                                limit:
                                                                    getLimitValue(
                                                                        USERS
                                                                    ) ?? 0
                                                            }
                                                        ) ||
                                                            `Current usage (${getUsageValue(USERS)}) exceeds limit (${getLimitValue(USERS)})`}
                                                    </p>
                                                </TooltipContent>
                                            </Tooltip>
                                        ) : (
                                            <>
                                                {getLimitValue(USERS) ??
                                                    t("billingUnlimited") ??
                                                    "∞"}{" "}
                                                {getLimitValue(USERS) !==
                                                    null && "users"}
                                            </>
                                        )}
                                    </InfoSectionContent>
                                </InfoSection>
                                <InfoSection>
                                    <InfoSectionTitle className="flex items-center gap-1 text-xs">
                                        {t("billingSites") || "Sites"}
                                    </InfoSectionTitle>
                                    <InfoSectionContent className="text-sm">
                                        {isOverLimit(SITES) ? (
                                            <Tooltip>
                                                <TooltipTrigger className="flex items-center gap-1">
                                                    <AlertTriangle className="h-3 w-3 text-orange-400" />
                                                    <span
                                                        className={cn(
                                                            "text-orange-600 dark:text-orange-400 font-medium"
                                                        )}
                                                    >
                                                        {getLimitValue(SITES) ??
                                                            t(
                                                                "billingUnlimited"
                                                            ) ??
                                                            "∞"}{" "}
                                                        {getLimitValue(
                                                            SITES
                                                        ) !== null && "sites"}
                                                    </span>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p>
                                                        {t(
                                                            "billingUsageExceedsLimit",
                                                            {
                                                                current:
                                                                    getUsageValue(
                                                                        SITES
                                                                    ),
                                                                limit:
                                                                    getLimitValue(
                                                                        SITES
                                                                    ) ?? 0
                                                            }
                                                        ) ||
                                                            `Current usage (${getUsageValue(SITES)}) exceeds limit (${getLimitValue(SITES)})`}
                                                    </p>
                                                </TooltipContent>
                                            </Tooltip>
                                        ) : (
                                            <>
                                                {getLimitValue(SITES) ??
                                                    t("billingUnlimited") ??
                                                    "∞"}{" "}
                                                {getLimitValue(SITES) !==
                                                    null && "sites"}
                                            </>
                                        )}
                                    </InfoSectionContent>
                                </InfoSection>
                                <InfoSection>
                                    <InfoSectionTitle className="flex items-center gap-1 text-xs">
                                        {t("billingDomains") || "Domains"}
                                    </InfoSectionTitle>
                                    <InfoSectionContent className="text-sm">
                                        {isOverLimit(DOMAINS) ? (
                                            <Tooltip>
                                                <TooltipTrigger className="flex items-center gap-1">
                                                    <AlertTriangle className="h-3 w-3 text-orange-400" />
                                                    <span
                                                        className={cn(
                                                            "text-orange-600 dark:text-orange-400 font-medium"
                                                        )}
                                                    >
                                                        {getLimitValue(
                                                            DOMAINS
                                                        ) ??
                                                            t(
                                                                "billingUnlimited"
                                                            ) ??
                                                            "∞"}{" "}
                                                        {getLimitValue(
                                                            DOMAINS
                                                        ) !== null && "domains"}
                                                    </span>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p>
                                                        {t(
                                                            "billingUsageExceedsLimit",
                                                            {
                                                                current:
                                                                    getUsageValue(
                                                                        DOMAINS
                                                                    ),
                                                                limit:
                                                                    getLimitValue(
                                                                        DOMAINS
                                                                    ) ?? 0
                                                            }
                                                        ) ||
                                                            `Current usage (${getUsageValue(DOMAINS)}) exceeds limit (${getLimitValue(DOMAINS)})`}
                                                    </p>
                                                </TooltipContent>
                                            </Tooltip>
                                        ) : (
                                            <>
                                                {getLimitValue(DOMAINS) ??
                                                    t("billingUnlimited") ??
                                                    "∞"}{" "}
                                                {getLimitValue(DOMAINS) !==
                                                    null && "domains"}
                                            </>
                                        )}
                                    </InfoSectionContent>
                                </InfoSection>
                                <InfoSection>
                                    <InfoSectionTitle className="flex items-center gap-1 text-xs">
                                        {t("billingOrganizations") ||
                                            "Organizations"}
                                    </InfoSectionTitle>
                                    <InfoSectionContent className="text-sm">
                                        {isOverLimit(ORGINIZATIONS) ? (
                                            <Tooltip>
                                                <TooltipTrigger className="flex items-center gap-1">
                                                    <AlertTriangle className="h-3 w-3 text-orange-400" />
                                                    <span
                                                        className={cn(
                                                            "text-orange-600 dark:text-orange-400 font-medium"
                                                        )}
                                                    >
                                                        {getLimitValue(
                                                            ORGINIZATIONS
                                                        ) ??
                                                            t(
                                                                "billingUnlimited"
                                                            ) ??
                                                            "∞"}{" "}
                                                        {getLimitValue(
                                                            ORGINIZATIONS
                                                        ) !== null && "orgs"}
                                                    </span>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p>
                                                        {t(
                                                            "billingUsageExceedsLimit",
                                                            {
                                                                current:
                                                                    getUsageValue(
                                                                        ORGINIZATIONS
                                                                    ),
                                                                limit:
                                                                    getLimitValue(
                                                                        ORGINIZATIONS
                                                                    ) ?? 0
                                                            }
                                                        ) ||
                                                            `Current usage (${getUsageValue(ORGINIZATIONS)}) exceeds limit (${getLimitValue(ORGINIZATIONS)})`}
                                                    </p>
                                                </TooltipContent>
                                            </Tooltip>
                                        ) : (
                                            <>
                                                {getLimitValue(ORGINIZATIONS) ??
                                                    t("billingUnlimited") ??
                                                    "∞"}{" "}
                                                {getLimitValue(
                                                    ORGINIZATIONS
                                                ) !== null && "orgs"}
                                            </>
                                        )}
                                    </InfoSectionContent>
                                </InfoSection>
                                <InfoSection>
                                    <InfoSectionTitle className="flex items-center gap-1 text-xs">
                                        {t("billingRemoteNodes") ||
                                            "Remote Nodes"}
                                    </InfoSectionTitle>
                                    <InfoSectionContent className="text-sm">
                                        {isOverLimit(REMOTE_EXIT_NODES) ? (
                                            <Tooltip>
                                                <TooltipTrigger className="flex items-center gap-1">
                                                    <AlertTriangle className="h-3 w-3 text-orange-400" />
                                                    <span
                                                        className={cn(
                                                            "text-orange-600 dark:text-orange-400 font-medium"
                                                        )}
                                                    >
                                                        {getLimitValue(
                                                            REMOTE_EXIT_NODES
                                                        ) ??
                                                            t(
                                                                "billingUnlimited"
                                                            ) ??
                                                            "∞"}{" "}
                                                        {getLimitValue(
                                                            REMOTE_EXIT_NODES
                                                        ) !== null && "nodes"}
                                                    </span>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p>
                                                        {t(
                                                            "billingUsageExceedsLimit",
                                                            {
                                                                current:
                                                                    getUsageValue(
                                                                        REMOTE_EXIT_NODES
                                                                    ),
                                                                limit:
                                                                    getLimitValue(
                                                                        REMOTE_EXIT_NODES
                                                                    ) ?? 0
                                                            }
                                                        ) ||
                                                            `Current usage (${getUsageValue(REMOTE_EXIT_NODES)}) exceeds limit (${getLimitValue(REMOTE_EXIT_NODES)})`}
                                                    </p>
                                                </TooltipContent>
                                            </Tooltip>
                                        ) : (
                                            <>
                                                {getLimitValue(
                                                    REMOTE_EXIT_NODES
                                                ) ??
                                                    t("billingUnlimited") ??
                                                    "∞"}{" "}
                                                {getLimitValue(
                                                    REMOTE_EXIT_NODES
                                                ) !== null && "nodes"}
                                            </>
                                        )}
                                    </InfoSectionContent>
                                </InfoSection>
                                <InfoSection>
                                    <InfoSectionTitle className="flex items-center gap-1 text-xs">
                                        {t("billingPublicResources") ||
                                            "Public Resources"}
                                    </InfoSectionTitle>
                                    <InfoSectionContent className="text-sm">
                                        {isOverLimit(PUBLIC_RESOURCES) ? (
                                            <Tooltip>
                                                <TooltipTrigger className="flex items-center gap-1">
                                                    <AlertTriangle className="h-3 w-3 text-orange-400" />
                                                    <span
                                                        className={cn(
                                                            "text-orange-600 dark:text-orange-400 font-medium"
                                                        )}
                                                    >
                                                        {getLimitValue(
                                                            PUBLIC_RESOURCES
                                                        ) ??
                                                            t(
                                                                "billingUnlimited"
                                                            ) ??
                                                            "∞"}
                                                    </span>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p>
                                                        {t(
                                                            "billingUsageExceedsLimit",
                                                            {
                                                                current:
                                                                    getUsageValue(
                                                                        PUBLIC_RESOURCES
                                                                    ),
                                                                limit:
                                                                    getLimitValue(
                                                                        PUBLIC_RESOURCES
                                                                    ) ?? 0
                                                            }
                                                        ) ||
                                                            `Current usage (${getUsageValue(PUBLIC_RESOURCES)}) exceeds limit (${getLimitValue(PUBLIC_RESOURCES)})`}
                                                    </p>
                                                </TooltipContent>
                                            </Tooltip>
                                        ) : (
                                            <>
                                                {getLimitValue(
                                                    PUBLIC_RESOURCES
                                                ) ??
                                                    t("billingUnlimited") ??
                                                    "∞"}
                                            </>
                                        )}
                                    </InfoSectionContent>
                                </InfoSection>
                                <InfoSection>
                                    <InfoSectionTitle className="flex items-center gap-1 text-xs">
                                        {t("billingPrivateResources") ||
                                            "Private Resources"}
                                    </InfoSectionTitle>
                                    <InfoSectionContent className="text-sm">
                                        {isOverLimit(PRIVATE_RESOURCES) ? (
                                            <Tooltip>
                                                <TooltipTrigger className="flex items-center gap-1">
                                                    <AlertTriangle className="h-3 w-3 text-orange-400" />
                                                    <span
                                                        className={cn(
                                                            "text-orange-600 dark:text-orange-400 font-medium"
                                                        )}
                                                    >
                                                        {getLimitValue(
                                                            PRIVATE_RESOURCES
                                                        ) ??
                                                            t(
                                                                "billingUnlimited"
                                                            ) ??
                                                            "∞"}
                                                    </span>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p>
                                                        {t(
                                                            "billingUsageExceedsLimit",
                                                            {
                                                                current:
                                                                    getUsageValue(
                                                                        PRIVATE_RESOURCES
                                                                    ),
                                                                limit:
                                                                    getLimitValue(
                                                                        PRIVATE_RESOURCES
                                                                    ) ?? 0
                                                            }
                                                        ) ||
                                                            `Current usage (${getUsageValue(PRIVATE_RESOURCES)}) exceeds limit (${getLimitValue(PRIVATE_RESOURCES)})`}
                                                    </p>
                                                </TooltipContent>
                                            </Tooltip>
                                        ) : (
                                            <>
                                                {getLimitValue(
                                                    PRIVATE_RESOURCES
                                                ) ??
                                                    t("billingUnlimited") ??
                                                    "∞"}
                                            </>
                                        )}
                                    </InfoSectionContent>
                                </InfoSection>
                                <InfoSection>
                                    <InfoSectionTitle className="flex items-center gap-1 text-xs">
                                        {t("billingMachineClients") ||
                                            "Machine Clients"}
                                    </InfoSectionTitle>
                                    <InfoSectionContent className="text-sm">
                                        {isOverLimit(MACHINE_CLIENTS) ? (
                                            <Tooltip>
                                                <TooltipTrigger className="flex items-center gap-1">
                                                    <AlertTriangle className="h-3 w-3 text-orange-400" />
                                                    <span
                                                        className={cn(
                                                            "text-orange-600 dark:text-orange-400 font-medium"
                                                        )}
                                                    >
                                                        {getLimitValue(
                                                            MACHINE_CLIENTS
                                                        ) ??
                                                            t(
                                                                "billingUnlimited"
                                                            ) ??
                                                            "∞"}
                                                    </span>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p>
                                                        {t(
                                                            "billingUsageExceedsLimit",
                                                            {
                                                                current:
                                                                    getUsageValue(
                                                                        MACHINE_CLIENTS
                                                                    ),
                                                                limit:
                                                                    getLimitValue(
                                                                        MACHINE_CLIENTS
                                                                    ) ?? 0
                                                            }
                                                        ) ||
                                                            `Current usage (${getUsageValue(MACHINE_CLIENTS)}) exceeds limit (${getLimitValue(MACHINE_CLIENTS)})`}
                                                    </p>
                                                </TooltipContent>
                                            </Tooltip>
                                        ) : (
                                            <>
                                                {getLimitValue(
                                                    MACHINE_CLIENTS
                                                ) ??
                                                    t("billingUnlimited") ??
                                                    "∞"}
                                            </>
                                        )}
                                    </InfoSectionContent>
                                </InfoSection>
                            </InfoSections>
                        </div>
                    </div>
                </SettingsSectionBody>
            </SettingsSection>

            {/* Paid License Keys Section */}
            {(licenseSubscription || getLicenseKeyCount() > 0) && (
                <SettingsSection>
                    <SettingsSectionHeader>
                        <SettingsSectionTitle>
                            {t("billingPaidLicenseKeys") || "Paid License Keys"}
                        </SettingsSectionTitle>
                        <SettingsSectionDescription>
                            {t("billingManageLicenseSubscription") ||
                                "Manage your subscription for paid self-hosted license keys"}
                        </SettingsSectionDescription>
                    </SettingsSectionHeader>
                    <SettingsSectionBody>
                        <SettingsSectionForm variant="half">
                            <SettingsFormGrid>
                                <SettingsFormCell span="full">
                                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border rounded-lg p-4">
                                        <div>
                                            <div className="text-sm text-muted-foreground mb-1">
                                                {t("billingCurrentKeys") ||
                                                    "Current Keys"}
                                            </div>
                                            <div className="flex items-baseline gap-2">
                                                <span className="text-3xl font-semibold">
                                                    {getLicenseKeyCount()}
                                                </span>
                                                <span className="text-lg">
                                                    {getLicenseKeyCount() === 1
                                                        ? "key"
                                                        : "keys"}
                                                </span>
                                            </div>
                                        </div>
                                        <Button
                                            variant="outline"
                                            onClick={handleModifySubscription}
                                            disabled={isLoading}
                                            loading={isLoading}
                                        >
                                            <CreditCard className="mr-2 h-4 w-4" />
                                            {t("billingModifyCurrentPlan") ||
                                                "Modify Current Plan"}
                                        </Button>
                                        <p className="text-sm text-muted-foreground mt-2">
                                            {t(
                                                "billingManageLicenseSubscriptionDescription"
                                            ) ||
                                                "Manage your subscription for paid self-hosted license keys and download invoices."}
                                        </p>
                                    </div>
                                </SettingsFormCell>
                            </SettingsFormGrid>
                        </SettingsSectionForm>
                    </SettingsSectionBody>
                </SettingsSection>
            )}

            {/* Tier Change Confirmation Dialog */}
            <Credenza
                open={showConfirmDialog}
                onOpenChange={setShowConfirmDialog}
            >
                <CredenzaContent>
                    <CredenzaHeader>
                        <CredenzaTitle>
                            {pendingTier?.action === "upgrade"
                                ? t("billingConfirmUpgrade") ||
                                  "Confirm Upgrade"
                                : t("billingConfirmDowngrade") ||
                                  "Confirm Downgrade"}
                        </CredenzaTitle>
                        <CredenzaDescription>
                            {pendingTier?.action === "upgrade"
                                ? t("billingConfirmUpgradeDescription") ||
                                  `You are about to upgrade to the ${pendingTier?.planName} plan.`
                                : t("billingConfirmDowngradeDescription") ||
                                  `You are about to downgrade to the ${pendingTier?.planName} plan.`}
                        </CredenzaDescription>
                    </CredenzaHeader>
                    <CredenzaBody>
                        {pendingTier && pendingTier.tier && (
                            <div className="space-y-4">
                                <div className="border rounded-lg p-4">
                                    <div className="text-2xl">
                                        {pendingTier.planName}
                                    </div>
                                    <div className="mt-1">
                                        <span className="text-xl">
                                            {pendingTier.price}
                                        </span>
                                    </div>
                                </div>

                                {/* Features with check marks */}
                                {(() => {
                                    const plan = planOptions.find(
                                        (p) =>
                                            p.tierType === pendingTier.tier ||
                                            (pendingTier.tier === "basic" &&
                                                p.id === "basic")
                                    );
                                    return plan?.features?.length ? (
                                        <div>
                                            <h4 className="font-semibold mb-3">
                                                {"What's included:"}
                                            </h4>
                                            <div className="space-y-2">
                                                {plan.features.map(
                                                    (feature, i) => (
                                                        <div
                                                            key={i}
                                                            className="flex items-center gap-2"
                                                        >
                                                            <Check className="h-4 w-4 text-green-600 shrink-0" />
                                                            <span>
                                                                {feature}
                                                            </span>
                                                        </div>
                                                    )
                                                )}
                                            </div>
                                        </div>
                                    ) : null;
                                })()}

                                {/* Limits without check marks */}
                                {tierLimits[pendingTier.tier] && (
                                    <div>
                                        <h4 className="font-semibold mb-3">
                                            {"Up to:"}
                                        </h4>
                                        <div className="space-y-2 text-sm text-muted-foreground">
                                            <div className="flex items-center gap-2">
                                                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                                                <span>
                                                    {
                                                        tierLimits[
                                                            pendingTier.tier
                                                        ].users
                                                    }{" "}
                                                    {t("billingUsers") ||
                                                        "Users"}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                                                <span>
                                                    {
                                                        tierLimits[
                                                            pendingTier.tier
                                                        ].sites
                                                    }{" "}
                                                    {t("billingSites") ||
                                                        "Sites"}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                                                <span>
                                                    {
                                                        tierLimits[
                                                            pendingTier.tier
                                                        ].domains
                                                    }{" "}
                                                    {t("billingDomains") ||
                                                        "Domains"}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                                                <span>
                                                    {
                                                        tierLimits[
                                                            pendingTier.tier
                                                        ].organizations
                                                    }{" "}
                                                    {t(
                                                        "billingOrganizations"
                                                    ) || "Organizations"}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                                                <span>
                                                    {
                                                        tierLimits[
                                                            pendingTier.tier
                                                        ].remoteNodes
                                                    }{" "}
                                                    {t("billingRemoteNodes") ||
                                                        "Remote Nodes"}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                                                <span>
                                                    {
                                                        tierLimits[
                                                            pendingTier.tier
                                                        ].publicResources
                                                    }{" "}
                                                    {t(
                                                        "billingPublicResources"
                                                    ) || "Public Resources"}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                                                <span>
                                                    {
                                                        tierLimits[
                                                            pendingTier.tier
                                                        ].privateResources
                                                    }{" "}
                                                    {t(
                                                        "billingPrivateResources"
                                                    ) || "Private Resources"}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                                                <span>
                                                    {
                                                        tierLimits[
                                                            pendingTier.tier
                                                        ].machineClients
                                                    }{" "}
                                                    {t(
                                                        "billingMachineClients"
                                                    ) || "Machine Clients"}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Warning for limit violations when downgrading */}
                                {pendingTier.action === "downgrade" &&
                                    (() => {
                                        const violations = checkLimitViolations(
                                            pendingTier.tier
                                        );
                                        if (violations.length > 0) {
                                            return (
                                                <Alert variant="destructive">
                                                    <AlertTriangle className="h-4 w-4" />
                                                    <AlertTitle>
                                                        {t(
                                                            "billingLimitViolationWarning"
                                                        ) ||
                                                            "Usage Exceeds New Plan Limits"}
                                                    </AlertTitle>
                                                    <AlertDescription>
                                                        <p className="mb-3">
                                                            {t(
                                                                "billingLimitViolationDescription"
                                                            ) ||
                                                                "Your current usage exceeds the limits of this plan. The following features will be disabled until you reduce usage:"}
                                                        </p>
                                                        <ul className="space-y-2">
                                                            {violations.map(
                                                                (
                                                                    violation,
                                                                    index
                                                                ) => (
                                                                    <li
                                                                        key={
                                                                            index
                                                                        }
                                                                        className="flex items-center gap-2"
                                                                    >
                                                                        <span className="font-medium">
                                                                            {
                                                                                violation.feature
                                                                            }
                                                                            :
                                                                        </span>
                                                                        <span>
                                                                            Currently
                                                                            using{" "}
                                                                            {
                                                                                violation.currentUsage
                                                                            }
                                                                            ,
                                                                            new
                                                                            limit
                                                                            is{" "}
                                                                            {
                                                                                violation.newLimit
                                                                            }
                                                                        </span>
                                                                    </li>
                                                                )
                                                            )}
                                                        </ul>
                                                    </AlertDescription>
                                                </Alert>
                                            );
                                        }
                                        return null;
                                    })()}

                                {/* Warning for feature loss when downgrading */}
                                {pendingTier.action === "downgrade" && (
                                    <Alert variant="warning">
                                        <AlertTriangle className="h-4 w-4" />
                                        <AlertTitle>
                                            {t("billingFeatureLossWarning") ||
                                                "Feature Availability Notice"}
                                        </AlertTitle>
                                        <AlertDescription>
                                            {t(
                                                "billingFeatureLossDescription"
                                            ) ||
                                                "By downgrading, features not available in the new plan will be automatically disabled. Some settings and configurations may be lost. Please review the pricing matrix to understand which features will no longer be available."}
                                        </AlertDescription>
                                    </Alert>
                                )}
                            </div>
                        )}
                    </CredenzaBody>
                    <CredenzaFooter>
                        <CredenzaClose asChild>
                            <Button variant="outline" disabled={isLoading}>
                                {t("cancel") || "Cancel"}
                            </Button>
                        </CredenzaClose>
                        <Button
                            onClick={confirmTierChange}
                            disabled={isLoading}
                            loading={isLoading}
                        >
                            {pendingTier?.action === "upgrade"
                                ? t("billingConfirmUpgradeButton") ||
                                  "Confirm Upgrade"
                                : t("billingConfirmDowngradeButton") ||
                                  "Confirm Downgrade"}
                        </Button>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>
        </SettingsContainer>
    );
}
