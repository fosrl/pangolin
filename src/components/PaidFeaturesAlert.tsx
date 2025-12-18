"use client";
import { Alert, AlertDescription } from "@app/components/ui/alert";
import { build } from "@server/build";
import { useTranslations } from "next-intl";
import { usePaidStatus } from "@app/hooks/usePaidStatus";

export function PaidFeaturesAlert() {
    const t = useTranslations();
    const { hasSaasSubscription, hasEnterpriseLicense } = usePaidStatus();
    return (
        <>
            {build === "saas" && !hasSaasSubscription ? (
                <Alert variant="info" className="mb-6">
                    <AlertDescription>
                        {t("subscriptionRequiredToUse")}
                    </AlertDescription>
                </Alert>
            ) : null}

            {build === "enterprise" && !hasEnterpriseLicense ? (
                <Alert variant="info" className="mb-6">
                    <AlertDescription>
                        {t("licenseRequiredToUse")}
                    </AlertDescription>
                </Alert>
            ) : null}
        </>
    );
}
