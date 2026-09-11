"use client";

import Link from "next/link";
import BrandingLogo from "@app/components/BrandingLogo";
import LoadingDots from "@app/components/LoadingDots";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";

export default function OrgRouteLoading() {
    const { env } = useEnvContext();
    const { isUnlocked } = useLicenseStatusContext();

    const logoWidth = isUnlocked()
        ? env.branding.logo?.navbar?.width || 98
        : 98;
    const logoHeight = isUnlocked()
        ? env.branding.logo?.navbar?.height || 32
        : 32;

    return (
        <div className="relative h-screen-safe overflow-hidden">
            <div className="absolute top-0 left-0 right-0 z-50">
                <div className="px-6 py-2">
                    <div className="container mx-auto max-w-12xl">
                        <div className="flex h-16 items-center">
                            <Link
                                href="/"
                                className="flex shrink-0 items-center"
                            >
                                <BrandingLogo
                                    width={logoWidth}
                                    height={logoHeight}
                                />
                            </Link>
                        </div>
                    </div>
                </div>
            </div>

            <div className="absolute inset-0 flex items-center justify-center">
                <LoadingDots size="md" />
            </div>
        </div>
    );
}
