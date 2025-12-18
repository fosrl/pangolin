import { build } from "@server/build";
import { useLicenseStatusContext } from "./useLicenseStatusContext";
import { useSubscriptionStatusContext } from "./useSubscriptionStatusContext";

export function usePaidStatus() {
    const { isUnlocked } = useLicenseStatusContext();
    const subscription = useSubscriptionStatusContext();

    // Check if features are disabled due to licensing/subscription
    const hasEnterpriseLicense = build === "enterprise" && isUnlocked();
    const hasSaasSubscription =
        build === "saas" &&
        subscription?.isSubscribed() &&
        subscription.isActive();

    return {
        hasEnterpriseLicense,
        hasSaasSubscription,
        isPaidUser: hasEnterpriseLicense || hasSaasSubscription
    };
}
