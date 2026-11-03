"use client";

import { Button } from "@app/components/ui/button";
import { ArrowRight, Shield } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import DismissableBanner from "./DismissableBanner";

type UsersBannerProps = {
    orgId: string;
};

export const UsersBanner = ({ orgId }: UsersBannerProps) => {
    const t = useTranslations();

    return (
        <DismissableBanner
            storageKey="users-banner-dismissed"
            version={1}
            title={t("usersBannerTitle")}
            titleIcon={<Shield className="w-5 h-5 text-primary" />}
            description={t("usersBannerDescription")}
        >
            <Link href={`/${orgId}/settings/general/security`}>
                <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 hover:bg-primary/10 hover:border-primary/50 transition-colors"
                >
                    {t("usersBannerButtonText")}
                    <ArrowRight className="w-4 h-4" />
                </Button>
            </Link>
        </DismissableBanner>
    );
};

export default UsersBanner;
