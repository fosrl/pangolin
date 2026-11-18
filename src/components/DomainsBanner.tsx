"use client";

import { Globe } from "lucide-react";
import { useTranslations } from "next-intl";
import DismissableBanner from "./DismissableBanner";

export const DomainsBanner = () => {
    const t = useTranslations();

    return (
        <DismissableBanner
            storageKey="domains-banner-dismissed"
            version={1}
            title={t("domainsBannerTitle")}
            titleIcon={<Globe className="w-5 h-5 text-primary" />}
            description={t("domainsBannerDescription")}
        />
    );
};

export default DomainsBanner;
