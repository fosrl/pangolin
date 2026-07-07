"use client";

// import { useSupporterStatusContext } from "@app/hooks/useSupporterStatusContext";
import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";
import { useTranslations } from "next-intl";
import { build } from "@server/build";

export default function AuthPageFooterNotices() {
    const t = useTranslations();
    // const { supporterStatus } = useSupporterStatusContext();
    const { isUnlocked, licenseStatus } = useLicenseStatusContext();

    return (
        <>
            {/* {supporterStatus?.visible && (
                <div className="text-center mt-2">
                    <span className="text-sm text-muted-foreground opacity-50">
                        {t("noSupportKey")}
                    </span>
                </div>
            )} */}
            {build === "enterprise" && !isUnlocked() ? (
                <div className="text-center mt-2">
                    <span className="text-sm font-medium text-muted-foreground">
                        {t("instanceIsUnlicensed")}
                    </span>
                </div>
            ) : null}
            {build === "enterprise" &&
            isUnlocked() &&
            licenseStatus?.tier === "personal" ? (
                <div className="text-center mt-2">
                    <span className="text-sm font-medium text-muted-foreground">
                        {t("loginPageLicenseWatermark")}
                    </span>
                </div>
            ) : null}
        </>
    );
}
