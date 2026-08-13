import ThemeSwitcher from "@app/components/ThemeSwitcher";
import AuthFooter from "@app/components/AuthFooter";
import {
    getLegacyIosStylesheetHrefs,
    isLegacyIosUserAgent
} from "@app/lib/legacyIosStylesheet";
import { Metadata } from "next";
import { headers } from "next/headers";

export const metadata: Metadata = {
    title: {
        template: `%s - ${process.env.BRANDING_APP_NAME || "Pangolin"}`,
        default: `Auth - ${process.env.BRANDING_APP_NAME || "Pangolin"}`
    },
    description: ""
};

type AuthLayoutProps = {
    children: React.ReactNode;
};

export default async function AuthLayout({ children }: AuthLayoutProps) {
    const requestHeaders = await headers();
    const userAgent = requestHeaders.get("user-agent") || "";
    const legacyIosStylesheets = isLegacyIosUserAgent(userAgent)
        ? getLegacyIosStylesheetHrefs()
        : [];

    return (
        <>
            {legacyIosStylesheets.map((href) => (
                <link
                    key={href}
                    rel="stylesheet"
                    href={href}
                    precedence="legacy-ios14"
                />
            ))}
            <div className="h-full flex flex-col">
                <div className="hidden md:flex justify-end items-center p-3 space-x-2">
                    <ThemeSwitcher />
                </div>

                <div className="flex-1 flex md:items-center justify-center">
                    <div className="w-full max-w-md p-3">{children}</div>
                </div>

                <AuthFooter />
            </div>
        </>
    );
}
