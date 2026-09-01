"use client";

import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import DismissableBanner from "./DismissableBanner";

export const AiProvidersBanner = () => {
    const t = useTranslations();

    return (
        <DismissableBanner
            storageKey="ai-providers-banner-dismissed"
            version={1}
            title={t("aiProvidersBannerTitle")}
            titleIcon={<Sparkles className="w-5 h-5 text-primary" />}
            description={t("aiProvidersBannerDescription")}
        />
    );
};

export default AiProvidersBanner;
