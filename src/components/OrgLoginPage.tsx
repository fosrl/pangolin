import { LoginFormIDP } from "@app/components/LoginForm";
import {
    LoadLoginPageBrandingResponse,
    LoadLoginPageResponse
} from "@server/routers/loginPage/types";
import IdpLoginButtons from "@app/components/IdpLoginButtons";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from "@app/components/ui/card";
import { Button } from "@app/components/ui/button";
import Link from "next/link";
import { replacePlaceholder } from "@app/lib/replacePlaceholder";
import PoweredByPangolin from "@app/components/PoweredByPangolin";
import BrandedAuthSurface from "@app/components/BrandedAuthSurface";
import { getTranslations } from "next-intl/server";
import { pullEnv } from "@app/lib/pullEnv";

type OrgLoginPageProps = {
    loginPage: LoadLoginPageResponse | undefined;
    loginIdps: LoginFormIDP[];
    branding: LoadLoginPageBrandingResponse | null;
    searchParams: {
        redirect?: string;
        forceLogin?: string;
    };
};

function buildQueryString(searchParams: {
    redirect?: string;
    forceLogin?: string;
}): string {
    const params = new URLSearchParams();
    if (searchParams.redirect) {
        params.set("redirect", searchParams.redirect);
    }
    if (searchParams.forceLogin) {
        params.set("forceLogin", searchParams.forceLogin);
    }
    const queryString = params.toString();
    return queryString ? `?${queryString}` : "";
}

export default async function OrgLoginPage({
    loginPage,
    loginIdps,
    branding,
    searchParams
}: OrgLoginPageProps) {
    const env = pullEnv();
    const t = await getTranslations();
    return (
        <BrandedAuthSurface primaryColor={branding?.primaryColor ?? null}>
            <PoweredByPangolin />
            <Card className="w-full max-w-md">
                <CardHeader>
                    {branding?.logoUrl && (
                        <div className="flex flex-row items-center justify-center mb-8">
                            <img
                                src={branding.logoUrl}
                                height={branding.logoHeight}
                                width={branding.logoWidth}
                            />
                        </div>
                    )}
                    <CardTitle>
                        {branding?.orgTitle
                            ? replacePlaceholder(branding.orgTitle, {
                                  orgName: branding.orgName
                              })
                            : t("orgAuthSignInTitle")}
                    </CardTitle>
                    <CardDescription>
                        {branding?.orgSubtitle
                            ? replacePlaceholder(branding.orgSubtitle, {
                                  orgName: branding.orgName
                              })
                            : loginIdps.length > 0
                              ? t("orgAuthChooseIdpDescription")
                              : ""}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {loginIdps.length > 0 ? (
                        <IdpLoginButtons
                            idps={loginIdps}
                            orgId={loginPage?.orgId}
                            redirect={searchParams.redirect}
                        />
                    ) : (
                        <div className="space-y-4">
                            <p className="text-sm text-muted-foreground">
                                {t("orgAuthNoIdpConfigured")}
                            </p>
                            <Link
                                href={`${env.app.dashboardUrl}/auth/login${buildQueryString(searchParams)}`}
                            >
                                <Button className="w-full">
                                    {t("orgAuthSignInWithPangolin")}
                                </Button>
                            </Link>
                        </div>
                    )}
                </CardContent>
            </Card>
            <p className="text-center text-muted-foreground mt-4">
                <Link
                    href={`${env.app.dashboardUrl}/auth/login${buildQueryString(searchParams)}`}
                    className="underline"
                >
                    {t("loginBack")}
                </Link>
            </p>
        </BrandedAuthSurface>
    );
}
