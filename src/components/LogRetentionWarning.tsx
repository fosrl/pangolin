"use client";

import ActionBanner from "@app/components/ActionBanner";
import { Button } from "@app/components/ui/button";
import { ArrowRight, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";

type LogRetentionWarningProps = {
    orgId: string;
    logTypeLabel: string;
};

export function LogRetentionWarning({
    orgId,
    logTypeLabel
}: LogRetentionWarningProps) {
    const t = useTranslations();

    return (
        <ActionBanner
            variant="warning"
            title={t("logRetentionDisabledWarningTitle")}
            titleIcon={<ShieldAlert className="w-5 h-5" />}
            description={t("logRetentionDisabledWarningDescription", {
                logType: logTypeLabel
            })}
            actions={
                <Link href={`/${orgId}/settings/general/security`}>
                    <Button variant="outline" className="gap-2">
                        {t("logRetentionDisabledWarningButton")}
                        <ArrowRight className="size-4" />
                    </Button>
                </Link>
            }
        />
    );
}

export default LogRetentionWarning;
