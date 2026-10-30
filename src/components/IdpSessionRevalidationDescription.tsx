"use client";

import { useTranslations } from "next-intl";

const SESSION_REVALIDATION_DOCS_URL =
    "https://docs.pangolin.net/manage/identity-providers/session-revalidation";

type IdpSessionRevalidationDescriptionProps = {
    className?: string;
};

export default function IdpSessionRevalidationDescription({
    className
}: IdpSessionRevalidationDescriptionProps) {
    const t = useTranslations();
    return (
        <span className={className}>
            {t("idpSessionRevalidationDescription")}{" "}
            <a
                href={SESSION_REVALIDATION_DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
            >
                {t("learnMore")}
            </a>
        </span>
    );
}
