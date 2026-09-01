"use client";

import { Button } from "@app/components/ui/button";
import {
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionFooter
} from "@app/components/Settings";
import EmailIdentityKeysForm from "@app/components/EmailIdentityKeysForm";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { formatVirtualApiKeyCredential } from "@app/lib/virtualApiKeyFormat";
import { ArrowRight, ExternalLink, Globe, KeyRound, Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";

const EXAMPLE_IDENTITY_KEY = formatVirtualApiKeyCredential(
    "k7m2n9qx",
    "a8f3c1e0b5d24791"
);

type IdentityKeysSplashProps = {
    orgId: string;
};

export default function IdentityKeysSplash({ orgId }: IdentityKeysSplashProps) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const [emailOpen, setEmailOpen] = useState(false);
    const emailEnabled = env.email.emailEnabled;

    const dashboardUrl = env.app.dashboardUrl?.replace(/\/$/, "") ?? "";
    const keysPath = `/${orgId}/keys`;
    const keysUrl = dashboardUrl ? `${dashboardUrl}${keysPath}` : keysPath;

    return (
        <>
            <SettingsSection>
                <SettingsSectionBody>
                    <div className="flex flex-col items-center text-center py-6 md:py-10 px-2">
                        <KeyRound className="h-8 w-8 text-primary" />
                        <h2 className="mt-4 text-2xl font-semibold tracking-tight max-w-xl">
                            {t("virtualApiKeysIdentitySplashTitle")}
                        </h2>
                        <p className="mt-3 text-sm text-muted-foreground max-w-lg">
                            {t("virtualApiKeysIdentitySplashDescription")}
                        </p>

                        <div className="mt-8 w-full max-w-lg text-left space-y-3">
                            <p className="text-sm font-medium text-center">
                                {t("virtualApiKeysIdentitySplashRetrieveTitle")}
                            </p>
                            <ul className="text-sm text-muted-foreground space-y-2">
                                <li className="flex items-start gap-2">
                                    <Globe className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                                    <span>
                                        {t(
                                            "virtualApiKeysIdentitySplashRetrieveResource"
                                        )}
                                    </span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                                    <span>
                                        {t.rich(
                                            "virtualApiKeysIdentitySplashRetrievePage",
                                            {
                                                url: () => (
                                                    <Link
                                                        href={keysPath}
                                                        className="font-medium text-foreground underline underline-offset-4 break-all"
                                                    >
                                                        {keysUrl}
                                                    </Link>
                                                )
                                            }
                                        )}
                                    </span>
                                </li>
                            </ul>
                        </div>

                        <p className="mt-8 text-sm text-muted-foreground max-w-lg">
                            {t("virtualApiKeysIdentitySplashManual")}
                        </p>
                        {!emailEnabled && (
                            <p className="mt-3 text-sm text-muted-foreground max-w-lg">
                                {t(
                                    "virtualApiKeysEmailSmtpRequiredDescription"
                                )}
                            </p>
                        )}
                    </div>
                </SettingsSectionBody>
                <SettingsSectionFooter className="justify-center md:justify-center">
                    <Button
                        disabled={!emailEnabled}
                        onClick={() => setEmailOpen(true)}
                    >
                        {t("virtualApiKeysEmailIdentity")}
                    </Button>
                    <Button asChild variant="outline">
                        <Link href={`/${orgId}/settings/virtual-api-keys/keys`}>
                            {t("virtualApiKeysIdentitySplashGoToVirtual")}
                            <ArrowRight className="ml-2 h-4 w-4" />
                        </Link>
                    </Button>
                </SettingsSectionFooter>
            </SettingsSection>
            <EmailIdentityKeysForm
                orgId={orgId}
                open={emailOpen}
                setOpen={setEmailOpen}
            />
        </>
    );
}
