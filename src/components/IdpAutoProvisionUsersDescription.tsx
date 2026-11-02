"use client";

import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";

const AUTO_PROVISION_DOCS_URL =
    "https://docs.pangolin.net/manage/identity-providers/auto-provisioning";

type IdpAutoProvisionUsersDescriptionProps = {
    className?: string;
};

export default function IdpAutoProvisionUsersDescription({
    className
}: IdpAutoProvisionUsersDescriptionProps) {
    const t = useTranslations();
    return (
        <span className={className}>
            {t("idpAutoProvisionUsersDescription")}{" "}
            <a
                href={AUTO_PROVISION_DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
            >
                {t("learnMore")}
                <ExternalLink className="size-3.5 shrink-0" />
            </a>
        </span>
    );
}
