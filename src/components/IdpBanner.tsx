"use client";

import { KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import DismissableBanner from "./DismissableBanner";

export const IdpBanner = () => {
    const t = useTranslations();

    return (
        <DismissableBanner
            storageKey="idp-banner-dismissed"
            version={1}
            title={t("idpBannerTitle")}
            titleIcon={<KeyRound className="w-5 h-5 text-primary" />}
            description={t("idpBannerDescription")}
        />
    );
};

export default IdpBanner;
