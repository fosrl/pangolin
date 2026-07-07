"use client";

import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";

type BrandedAuthSurfaceProps = {
    primaryColor?: string | null;
    children: React.ReactNode;
};

export default function BrandedAuthSurface({
    primaryColor,
    children
}: BrandedAuthSurfaceProps) {
    const { isUnlocked } = useLicenseStatusContext();

    return (
        <div
            style={{
                // @ts-expect-error CSS variable
                "--primary": isUnlocked() ? primaryColor : null
            }}
        >
            {children}
        </div>
    );
}
