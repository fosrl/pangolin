"use client";

import { Button } from "@app/components/ui/button";
import {
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionFooter
} from "@app/components/Settings";
import { ArrowRight, Settings, ShieldCheck, User } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";

type ApprovalsEmptyStateProps = {
    orgId: string;
};

export function ApprovalsEmptyState({ orgId }: ApprovalsEmptyStateProps) {
    const t = useTranslations();

    return (
        <SettingsSection>
            <SettingsSectionBody>
                <div className="flex flex-col items-center text-center py-6 md:py-10 px-2">
                    <ShieldCheck className="h-8 w-8 text-primary" />
                    <h2 className="mt-4 text-2xl font-semibold tracking-tight max-w-xl">
                        {t("approvalsEmptyStateTitle")}
                    </h2>
                    <p className="mt-3 text-sm text-muted-foreground max-w-lg">
                        {t("approvalsEmptyStateDescription")}
                    </p>

                    <div className="mt-8 w-full max-w-lg text-left space-y-3">
                        <p className="text-sm font-medium text-center">
                            {t("approvalsEmptyStateHowToTitle")}
                        </p>
                        <ul className="text-sm text-muted-foreground space-y-2">
                            <li className="flex items-start gap-2">
                                <Settings className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                                <span>
                                    {t("approvalsEmptyStateStep1Description")}
                                </span>
                            </li>
                            <li className="flex items-start gap-2">
                                <User className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                                <span>
                                    {t("approvalsEmptyStateStep2Description")}
                                </span>
                            </li>
                        </ul>
                    </div>

                    <p className="mt-8 text-sm text-muted-foreground max-w-lg">
                        {t("approvalsEmptyStatePreviewDescription")}
                    </p>
                </div>
            </SettingsSectionBody>
            <SettingsSectionFooter className="justify-center md:justify-center">
                <Button asChild>
                    <Link href={`/${orgId}/settings/access/roles`}>
                        {t("approvalsEmptyStateButtonText")}
                        <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                </Button>
            </SettingsSectionFooter>
        </SettingsSection>
    );
}
