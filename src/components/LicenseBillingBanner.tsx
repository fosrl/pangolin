"use client";

import { Globe, CreditCard, ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "@app/components/ui/button";
import DismissableBanner from "./DismissableBanner";

type LicenseBillingBannerProps = {
    orgId: string;
};

export const LicenseBillingBanner = ({ orgId }: LicenseBillingBannerProps) => {
    const t = useTranslations();

    return (
        <DismissableBanner
            storageKey="license-billing-banner-dismissed"
            version={1}
            title={t("licenseBillingBannerTitle")}
            titleIcon={<Globe className="w-5 h-5 text-primary" />}
            description={t("licenseBillingBannerDescription")}
        >
            <Link href={`/${orgId}/settings/billing`}>
                <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 hover:bg-primary/10 hover:border-primary/50 transition-colors"
                >
                    <CreditCard className="w-4 h-4" />
                    {t("licenseBillingBannerButton")}
                    <ArrowRight className="w-4 h-4" />
                </Button>
            </Link>
        </DismissableBanner>
    );
};

export default LicenseBillingBanner;
