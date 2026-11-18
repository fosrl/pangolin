"use client";

import { Button } from "@app/components/ui/button";
import {
    formatLicenseLimitViolations,
    LicenseLimitViolation
} from "@app/lib/licenseLimits";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import DismissableBanner from "./DismissableBanner";

type LicenseLimitsExceededBannerProps = {
    violations: LicenseLimitViolation[];
    purchaseUrl: string;
};

export const LicenseLimitsExceededBanner = ({
    violations,
    purchaseUrl
}: LicenseLimitsExceededBannerProps) => {
    const t = useTranslations();

    if (violations.length === 0) {
        return null;
    }

    return (
        <DismissableBanner
            storageKey="license-limits-exceeded-banner-dismissed"
            version={1}
            title={t("licenseLimitsExceededBannerTitle")}
            titleIcon={<AlertTriangle className="w-5 h-5 text-amber-500" />}
            description={t("licenseLimitsExceededBannerDescription", {
                details: formatLicenseLimitViolations(violations, t)
            })}
            dismissable={false}
        >
            <Link href={purchaseUrl} target="_blank" rel="noopener noreferrer">
                <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 hover:bg-primary/10 hover:border-primary/50 transition-colors"
                >
                    {t("licenseUpgradeBannerButton")}
                    <ExternalLink className="w-4 h-4" />
                </Button>
            </Link>
        </DismissableBanner>
    );
};

export default LicenseLimitsExceededBanner;
