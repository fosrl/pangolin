"use client";

import { Button } from "@app/components/ui/button";
import { ClockIcon, ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import DismissableBanner from "./DismissableBanner";

type TrialBillingBannerProps = {
    onUpgrade: () => void;
    tierName: string;
};

export const TrialBillingBanner = ({
    onUpgrade,
    tierName
}: TrialBillingBannerProps) => {
    const t = useTranslations();

    return (
        <DismissableBanner
            storageKey="trial-billing-banner-dismissed"
            version={1}
            title={t("billingTrialBannerTitle")}
            titleIcon={<ClockIcon className="w-5 h-5 text-primary" />}
            description={t("billingTrialBannerDescription", {
                tier: tierName
            })}
            dismissable={false}
        >
            <Button
                variant="outline"
                size="sm"
                className="gap-2 hover:bg-primary/10 hover:border-primary/50 transition-colors"
                onClick={onUpgrade}
            >
                {t("billingTrialBannerUpgrade")}
                <ArrowRight className="w-4 h-4" />
            </Button>
        </DismissableBanner>
    );
};

export default TrialBillingBanner;
