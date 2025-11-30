"use client";
import { Alert, AlertDescription } from "@app/components/ui/alert";
import { build } from "@server/build";
import { useTranslations } from "next-intl";
import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";
import { useSubscriptionStatusContext } from "@app/hooks/useSubscriptionStatusContext";

export function SecurityFeaturesAlert() {
    const t = useTranslations();
    const { isUnlocked } = useLicenseStatusContext();
    const subscriptionStatus = useSubscriptionStatusContext();

    return (
        <>
            {build === "saas" && !subscriptionStatus?.isSubscribed() ? (
                <Alert variant="info" className="mb-6">
                    <AlertDescription>
                        {t("subscriptionRequiredToUse")}
                    </AlertDescription>
                </Alert>
            ) : null}

            {build === "enterprise" && !isUnlocked() ? (
                <Alert variant="info" className="mb-6">
                    <AlertDescription>
                        {t("licenseRequiredToUse")}
                    </AlertDescription>
                </Alert>
            ) : null}
        </>
    );
}

