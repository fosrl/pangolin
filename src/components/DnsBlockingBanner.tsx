"use client";

import { Button } from "@app/components/ui/button";
import { ArrowRight, ShieldBan } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import DismissableBanner from "./DismissableBanner";

type DnsBlockingBannerProps = {
    orgId: string;
};

export const DnsBlockingBanner = ({ orgId }: DnsBlockingBannerProps) => {
    const t = useTranslations();

    return (
        <DismissableBanner
            storageKey="dns-blocking-banner-dismissed"
            version={1}
            title={t("dnsBlockingBannerTitle")}
            titleIcon={<ShieldBan className="w-5 h-5 text-primary" />}
            description={t("dnsBlockingBannerDescription")}
        >
            <Link href={`/${orgId}/settings/access/roles`}>
                <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 hover:bg-primary/10 hover:border-primary/50 transition-colors"
                >
                    {t("dnsBlockingBannerButton")}
                    <ArrowRight className="w-4 h-4" />
                </Button>
            </Link>
        </DismissableBanner>
    );
};

export default DnsBlockingBanner;
