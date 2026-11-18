"use client";

import { Button } from "@app/components/ui/button";
import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";
import {
    formatLicenseLimitViolations,
    getLicenseLimitViolations
} from "@app/lib/licenseLimits";
import { useState } from "react";
import { useTranslations } from "next-intl";

export default function LicenseViolation() {
    const { licenseStatus } = useLicenseStatusContext();
    const [isDismissed, setIsDismissed] = useState(false);
    const t = useTranslations();

    if (!licenseStatus || isDismissed) return null;

    if (!licenseStatus.isHostLicensed || licenseStatus.isLicenseValid) {
        return null;
    }

    const limitViolations = getLicenseLimitViolations(licenseStatus);

    // The key is valid but usage is over the licensed amounts
    if (limitViolations.length > 0) {
        return (
            <div className="fixed bottom-0 left-0 right-0 w-full bg-amber-600 text-white p-4 text-center z-50">
                <div className="flex flex-wrap justify-center items-center gap-2 sm:gap-4">
                    <p className="text-sm sm:text-base">
                        {t("componentsLicenseLimitsExceeded", {
                            details: formatLicenseLimitViolations(
                                limitViolations,
                                t
                            )
                        })}
                    </p>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="hover:bg-white/20 text-white"
                        onClick={() => setIsDismissed(true)}
                    >
                        {t("dismiss")}
                    </Button>
                </div>
            </div>
        );
    }

    // Invalid or expired keys
    return (
        <div className="fixed bottom-0 left-0 right-0 w-full bg-red-500 text-white p-4 text-center z-50">
            <div className="flex justify-between items-center">
                <p>{t("componentsInvalidKey")}</p>
                <Button
                    variant={"ghost"}
                    className="hover:bg-yellow-500"
                    onClick={() => setIsDismissed(true)}
                >
                    {t("dismiss")}
                </Button>
            </div>
        </div>
    );
}
