"use client";

import { Button } from "@app/components/ui/button";
import { Shield, ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import DismissableBanner from "./DismissableBanner";

export const ResourcePoliciesBanner = () => {
    const t = useTranslations();

    return (
        <DismissableBanner
            storageKey="resource-policies-banner-dismissed"
            version={1}
            title={t("resourcePoliciesBannerTitle")}
            titleIcon={<Shield className="w-5 h-5 text-primary" />}
            description={t("resourcePoliciesBannerDescription")}
        >
            <Link
                href="https://docs.pangolin.net/manage/resources/public/resource-policies"
                target="_blank"
                rel="noopener noreferrer"
            >
                <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 hover:bg-primary/10 hover:border-primary/50 transition-colors"
                >
                    {t("resourcePoliciesBannerButtonText")}
                    <ArrowRight className="w-4 h-4" />
                </Button>
            </Link>
        </DismissableBanner>
    );
};

export default ResourcePoliciesBanner;
