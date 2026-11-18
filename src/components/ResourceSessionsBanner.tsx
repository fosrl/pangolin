"use client";

import { MonitorSmartphone } from "lucide-react";
import { useTranslations } from "next-intl";
import DismissableBanner from "./DismissableBanner";

export const ResourceSessionsBanner = () => {
    const t = useTranslations();

    return (
        <DismissableBanner
            storageKey="resource-sessions-banner-dismissed"
            version={1}
            title={t("resourceSessionsBannerTitle")}
            titleIcon={<MonitorSmartphone className="w-5 h-5 text-primary" />}
            description={t("resourceSessionsBannerDescription")}
        />
    );
};

export default ResourceSessionsBanner;
