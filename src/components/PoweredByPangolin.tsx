"use client";

import Link from "next/link";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";
import { useTranslations } from "next-intl";
import { build } from "@server/build";

function PoweredByLabel({ brandName }: { brandName: string }) {
    const t = useTranslations();

    return (
        <div className="text-center mb-2">
            <span className="text-sm text-muted-foreground">
                {t("poweredBy")}{" "}
                {brandName === "Pangolin" ? (
                    <Link
                        href="https://pangolin.net/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                    >
                        Pangolin
                    </Link>
                ) : (
                    brandName
                )}
            </span>
        </div>
    );
}

export default function PoweredByPangolin() {
    const { env } = useEnvContext();
    const { isUnlocked } = useLicenseStatusContext();

    if (isUnlocked() && build === "enterprise") {
        if (
            env.branding.resourceAuthPage?.hidePoweredBy ||
            env.branding.hidePoweredBy
        ) {
            return null;
        }

        return (
            <PoweredByLabel
                brandName={env.branding.appName || "Pangolin"}
            />
        );
    }

    return <PoweredByLabel brandName="Pangolin" />;
}
