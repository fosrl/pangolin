"use client";

import { ArrowRightLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import DismissableBanner from "./DismissableBanner";

export const RedirectsBanner = () => {
    const t = useTranslations();

    return (
        <DismissableBanner
            storageKey="redirects-banner-dismissed"
            version={1}
            title={t("redirectsBannerTitle")}
            titleIcon={<ArrowRightLeft className="w-5 h-5 text-primary" />}
            description={t("redirectsBannerDescription")}
        />
    );
};

export default RedirectsBanner;
