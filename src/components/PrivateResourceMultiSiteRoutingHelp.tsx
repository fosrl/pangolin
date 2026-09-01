"use client";

import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";

export function PrivateResourceMultiSiteRoutingHelp() {
    const t = useTranslations();

    return (
        <p className="text-sm text-muted-foreground mt-2">
            {t("internalResourceFormMultiSiteRoutingHelp")}{" "}
            <a
                href="https://docs.pangolin.net/manage/resources/private/multi-site-routing"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
            >
                {t("internalResourceFormMultiSiteRoutingHelpLearnMore")}
                <ExternalLink className="size-3.5 shrink-0" />
            </a>
            .
        </p>
    );
}
