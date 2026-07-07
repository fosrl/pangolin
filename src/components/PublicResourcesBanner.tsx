"use client";

import { Globe } from "lucide-react";
import { useTranslations } from "next-intl";
import DismissableBanner from "./DismissableBanner";

export const PublicResourcesBanner = () => {
    const t = useTranslations();

    return (
        <DismissableBanner
            storageKey="proxy-resources-banner-dismissed"
            version={1}
            title={t("publicResourcesBannerTitle")}
            titleIcon={<Globe className="w-5 h-5 text-primary" />}
            description={t("publicResourcesBannerDescription")}
        />
    );
};

export default PublicResourcesBanner;
