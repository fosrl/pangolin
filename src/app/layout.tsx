import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { ThemeProvider } from "@app/providers/ThemeProvider";
import EnvProvider from "@app/providers/EnvProvider";
import { pullEnv } from "@app/lib/pullEnv";
import { sanitizeEnvForAnonymousClient } from "@app/lib/publicEnv";
import ThemeDataProvider from "@app/providers/ThemeDataProvider";
import SplashImage from "@app/components/SplashImage";
import SupportStatusProvider from "@app/providers/SupporterStatusProvider";
import { priv } from "@app/lib/api";
import { AxiosResponse } from "axios";
import { IsSupporterKeyVisibleResponse } from "@server/routers/supporterKey";
import LicenseStatusProvider from "@app/providers/LicenseStatusProvider";
import { GetLicenseStatusResponse } from "@server/routers/license/types";
import LicenseViolation from "@app/components/LicenseViolation";
import { cache } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { Toaster } from "@app/components/ui/toaster";
import { build } from "@server/build";
import { TopLoader } from "@app/components/Toploader";
import Script from "next/script";
import { TanstackQueryProvider } from "@app/components/TanstackQueryProvider";
import { TailwindIndicator } from "@app/components/TailwindIndicator";
import { ViewportHeightFix } from "@app/components/ViewportHeightFix";
import StoreInternalRedirect from "@app/components/StoreInternalRedirect";
import localFont from "next/font/local";

export const metadata: Metadata = {
    title: `Dashboard - ${process.env.BRANDING_APP_NAME || "Pangolin"}`,
    description: ""
};

export const dynamic = "force-dynamic";

const monaSans = localFont({
    src: [
        {
            path: "../fonts/mona-sans/MonaSans-Regular.woff2",
            weight: "400",
            style: "normal"
        },
        {
            path: "../fonts/mona-sans/MonaSans-Medium.woff2",
            weight: "500",
            style: "normal"
        },
        {
            path: "../fonts/mona-sans/MonaSans-SemiBold.woff2",
            weight: "600",
            style: "normal"
        },
        {
            path: "../fonts/mona-sans/MonaSans-Bold.woff2",
            weight: "700",
            style: "normal"
        }
    ],
    display: "swap"
});

const fontClassName = monaSans.className;

export default async function RootLayout({
    children
}: Readonly<{
    children: React.ReactNode;
}>) {
    const env = pullEnv();
    // Anonymous visitors (login, signup, resource auth) have no session
    // cookie, so they receive a sanitized env in the RSC payload: the
    // version, internal ports and GeoIP paths only matter inside the
    // authenticated dashboard shell. See #3856.
    const hasSessionCookie = (await cookies()).has(
        env.server.sessionCookieName
    );
    const clientEnv = hasSessionCookie
        ? env
        : sanitizeEnvForAnonymousClient(env);
    const locale = await getLocale();

    // const supporterData = {
    //     visible: true
    // } as any;

    // const res = await priv.get<AxiosResponse<IsSupporterKeyVisibleResponse>>(
    //     "supporter-key/visible"
    // );
    // supporterData.visible = res.data.data.visible;
    // supporterData.tier = res.data.data.tier;

    let licenseStatus: GetLicenseStatusResponse;
    if (build === "enterprise") {
        const licenseStatusRes = await cache(
            async () =>
                await priv.get<AxiosResponse<GetLicenseStatusResponse>>(
                    "/license/status"
                )
        )();
        licenseStatus = licenseStatusRes.data.data;
    } else if (build === "saas") {
        licenseStatus = {
            isHostLicensed: true,
            isLicenseValid: true,
            hostId: "saas"
        };
    } else {
        licenseStatus = {
            isHostLicensed: false,
            isLicenseValid: false,
            hostId: ""
        };
    }

    return (
        <html suppressHydrationWarning lang={locale}>
            <body className={`${fontClassName} h-screen-safe overflow-hidden`}>
                <StoreInternalRedirect />
                <TopLoader />
                {/* build === "saas" && (
                    <Script
                        src="https://rybbit.fossorial.io/api/script.js"
                        data-site-id="fe1ff2a33287"
                        strategy="afterInteractive"
                    />
                )*/}
                <ViewportHeightFix />
                <NextIntlClientProvider>
                    <ThemeProvider
                        attribute="class"
                        defaultTheme="system"
                        enableSystem
                        disableTransitionOnChange
                    >
                        <ThemeDataProvider colors={loadBrandingColors()}>
                            <EnvProvider env={clientEnv}>
                                <TanstackQueryProvider>
                                    <LicenseStatusProvider
                                        licenseStatus={licenseStatus}
                                    >
                                        {/* <SupportStatusProvider
                                            supporterStatus={supporterData}
                                        > */}
                                        {/* Main content */}
                                        <div className="h-full flex flex-col">
                                            <div className="flex-1 overflow-auto">
                                                <SplashImage>
                                                    <LicenseViolation />
                                                    {children}
                                                </SplashImage>
                                                <LicenseViolation />
                                            </div>
                                        </div>
                                        {/* </SupportStatusProvider> */}
                                    </LicenseStatusProvider>
                                    <Toaster />
                                </TanstackQueryProvider>
                            </EnvProvider>
                        </ThemeDataProvider>
                    </ThemeProvider>
                </NextIntlClientProvider>

                {/*process.env.NODE_ENV === "development" && (
                    <TailwindIndicator />
                )*/}
            </body>
        </html>
    );
}

function loadBrandingColors() {
    // this is loaded once on the server and not included in pullEnv
    // so we don't need to parse the json every time pullEnv is called
    if (process.env.BRANDING_COLORS) {
        try {
            return JSON.parse(process.env.BRANDING_COLORS);
        } catch (e) {
            console.error("Failed to parse BRANDING_COLORS", e);
        }
    }
}
