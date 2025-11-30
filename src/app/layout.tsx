import type { Metadata } from "next";
import "./globals.css";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@app/providers/ThemeProvider";
import EnvProvider from "@app/providers/EnvProvider";
import { pullEnv } from "@app/lib/pullEnv";
import ThemeDataProvider from "@app/providers/ThemeDataProvider";
import SplashImage from "@app/components/private/SplashImage";
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

export const metadata: Metadata = {
    title: `Dashboard - ${process.env.BRANDING_APP_NAME || "Pangolin"}`,
    description: "",

    ...(process.env.BRANDING_FAVICON_PATH
        ? {
              icons: {
                  icon: [
                      {
                          url: process.env.BRANDING_FAVICON_PATH as string
                      }
                  ]
              }
          }
        : {})
};

export const dynamic = "force-dynamic";

const font = Inter({ subsets: ["latin"] });

export default async function RootLayout({
    children
}: Readonly<{
    children: React.ReactNode;
}>) {
    const env = pullEnv();
    const locale = await getLocale();

    const supporterData = {
        visible: true
    } as any;

    const res = await priv.get<AxiosResponse<IsSupporterKeyVisibleResponse>>(
        "supporter-key/visible"
    );
    supporterData.visible = res.data.data.visible;
    supporterData.tier = res.data.data.tier;

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
            <body className={`${font.className} h-screen overflow-hidden`}>
                <TopLoader />
                {build === "saas" && (
                    <Script
                        src="https://rybbit.fossorial.io/api/script.js"
                        data-site-id="fe1ff2a33287"
                        strategy="afterInteractive"
                    />
                )}
                <NextIntlClientProvider>
                    <ThemeProvider
                        attribute="class"
                        defaultTheme="system"
                        enableSystem
                        disableTransitionOnChange
                    >
                        <ThemeDataProvider colors={loadBrandingColors()}>
                            <EnvProvider env={pullEnv()}>
                                <LicenseStatusProvider
                                    licenseStatus={licenseStatus}
                                >
                                    <SupportStatusProvider
                                        supporterStatus={supporterData}
                                    >
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
                                    </SupportStatusProvider>
                                </LicenseStatusProvider>
                                <Toaster />
                            </EnvProvider>
                        </ThemeDataProvider>
                    </ThemeProvider>
                </NextIntlClientProvider>
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
