"use client";

import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";
import { build } from "@server/build";

type CustomCssStyleProps = {
    css?: string | null;
};

// Prevent the stylesheet from closing its own <style> element and injecting markup
function escapeCss(css: string) {
    return css.replace(/<\/style/gi, "<\\/style");
}

// Renders user-provided CSS. Only available on licensed self-hosted enterprise builds.
export default function CustomCssStyle({ css }: CustomCssStyleProps) {
    const { isUnlocked } = useLicenseStatusContext();

    if (build !== "enterprise" || !isUnlocked() || !css?.trim()) {
        return null;
    }

    return (
        <style
            data-pangolin-custom-css=""
            dangerouslySetInnerHTML={{ __html: escapeCss(css) }}
        />
    );
}
