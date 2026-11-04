"use client";

import { Link2 } from "lucide-react";
import { useTranslations } from "next-intl";
import DismissableBanner from "./DismissableBanner";

export const ShareLinksBanner = () => {
    const t = useTranslations();

    return (
        <DismissableBanner
            storageKey="share-links-banner-dismissed"
            version={1}
            title={t("shareLinksBannerTitle")}
            titleIcon={<Link2 className="w-5 h-5 text-primary" />}
            description={t("shareLinksBannerDescription")}
        />
    );
};

export default ShareLinksBanner;
