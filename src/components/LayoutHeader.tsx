"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import ProfileIcon from "@app/components/ProfileIcon";
import ThemeSwitcher from "@app/components/ThemeSwitcher";
import { useTheme } from "next-themes";
import BrandingLogo from "./BrandingLogo";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";

interface LayoutHeaderProps {
    showTopBar: boolean;
}

export function LayoutHeader({ showTopBar }: LayoutHeaderProps) {
    const { theme } = useTheme();
    const [path, setPath] = useState<string>("");
    const { env } = useEnvContext();
    const { isUnlocked } = useLicenseStatusContext();

    const logoWidth = isUnlocked()
        ? env.branding.logo?.navbar?.width || 98
        : 98;
    const logoHeight = isUnlocked()
        ? env.branding.logo?.navbar?.height || 32
        : 32;

    useEffect(() => {
        function getPath() {
            let lightOrDark = theme;

            if (theme === "system" || !theme) {
                lightOrDark = window.matchMedia("(prefers-color-scheme: dark)")
                    .matches
                    ? "dark"
                    : "light";
            }

            if (lightOrDark === "light") {
                return "/logo/word_mark_black.png";
            }

            return "/logo/word_mark_white.png";
        }

        setPath(getPath());
    }, [theme]);

    return (
        <div className="absolute top-0 left-0 right-0 z-50 hidden md:block">
            <div className="absolute inset-0 bg-background/83 backdrop-blur-sm" />
            <div className="relative z-10 px-6 py-2">
                <div className="container mx-auto max-w-12xl">
                    <div className="h-16 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Link href="/" className="flex items-center">
                                <BrandingLogo
                                    width={logoWidth}
                                    height={logoHeight}
                                />
                            </Link>
                            {/* {build === "saas" && (
                                <Badge variant="secondary">Cloud Beta</Badge>
                            )} */}
                        </div>

                        {showTopBar && (
                            <div className="flex items-center space-x-2">
                                <ThemeSwitcher />
                                <ProfileIcon />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default LayoutHeader;
