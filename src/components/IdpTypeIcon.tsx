"use client";

import { cn } from "@app/lib/cn";
import Image from "next/image";
import { ReactNode } from "react";

type Props = {
    type?: string | null;
    variant?: string | null;
    size?: number;
    className?: string;
    alt?: string;
    fallback?: ReactNode;
};

export default function IdpTypeIcon({
    type,
    variant,
    size = 16,
    className,
    alt,
    fallback = null
}: Props) {
    const effectiveType = (variant || type || "").toLowerCase();

    console.log(`[IdpTypeIcon]`, { effectiveType, variant, type });

    let src: string | null = null;
    let defaultAlt = "";

    if (effectiveType === "google") {
        src = "/idp/google.png";
        defaultAlt = "Google";
    } else if (effectiveType === "azure") {
        src = "/idp/azure.png";
        defaultAlt = "Azure";
    } else if (effectiveType === "oidc") {
        src = "/idp/openid.png";
        defaultAlt = "OAuth2/OIDC";
    }

    if (!src) {
        return <>{fallback}</>;
    }

    return (
        <Image
            src={src}
            alt={alt ?? defaultAlt}
            width={size}
            height={size}
            className={cn("shrink-0 rounded", className)}
        />
    );
}
