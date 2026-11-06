"use client";

import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";
import CustomCssStyle from "@app/components/CustomCssStyle";

type BrandedAuthSurfaceProps = {
    primaryColor?: string | null;
    customCss?: string | null;
    children: React.ReactNode;
};

export default function BrandedAuthSurface({
    primaryColor,
    customCss,
    children
}: BrandedAuthSurfaceProps) {
    const { isUnlocked } = useLicenseStatusContext();

    return (
        <div
            className="branded-auth-surface"
            style={{
                // @ts-expect-error CSS variable
                "--primary": isUnlocked() ? primaryColor : null
            }}
        >
            <CustomCssStyle css={customCss} />
            {children}
        </div>
    );
}
