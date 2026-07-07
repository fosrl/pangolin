import { verifySession } from "@app/lib/auth/verifySession";
import Link from "next/link";
import { redirect } from "next/navigation";
import OrgSignInLink from "@app/components/OrgSignInLink";
import { cache } from "react";
import SmartLoginForm from "@app/components/SmartLoginForm";
import DashboardLoginForm from "@app/components/DashboardLoginForm";
import { Mail } from "lucide-react";
import { pullEnv } from "@app/lib/pullEnv";
import { cleanRedirect } from "@app/lib/cleanRedirect";
import { getTranslations } from "next-intl/server";
import { build } from "@server/build";
import { LoadLoginPageResponse } from "@server/routers/loginPage/types";
import { Card, CardContent } from "@app/components/ui/card";
import LoginCardHeader from "@app/components/LoginCardHeader";
import { priv } from "@app/lib/api";
import { AxiosResponse } from "axios";
import { LoginFormIDP } from "@app/components/LoginForm";
import { ListIdpsResponse } from "@server/routers/idp";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Log In"
};

export const dynamic = "force-dynamic";

export default async function Page(props: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
    const searchParams = await props.searchParams;
    const getUser = cache(verifySession);
    const user = await getUser({ skipCheckVerifyEmail: true });

    const isInvite = searchParams?.redirect?.includes("/invite");
    const forceLoginParam = searchParams?.forceLogin;
    const forceLogin = forceLoginParam === "true";

    const env = pullEnv();

    const signUpDisabled = env.flags.disableSignupWithoutInvite;

    if (user && !forceLogin) {
        redirect("/");
    }

    // Check for orgId and redirect to org-specific login page if found
    const orgId = searchParams.orgId as string | undefined;
    let loginPageDomain: string | undefined;
    if (orgId) {
        try {
            const res = await priv.get<AxiosResponse<LoadLoginPageResponse>>(
                `/login-page?orgId=${orgId}`
            );

            if (res && res.status === 200 && res.data.data.fullDomain) {
                loginPageDomain = res.data.data.fullDomain;
            }
        } catch (e) {
            console.debug("No custom login page found for org", orgId);
        }
    }

    if (loginPageDomain) {
        const redirectUrl = searchParams.redirect as string | undefined;

        let url = `https://${loginPageDomain}/auth/org`;
        if (redirectUrl) {
            url += `?redirect=${redirectUrl}`;
        }
        redirect(url);
    }

    let redirectUrl: string | undefined = undefined;
    if (searchParams.redirect) {
        redirectUrl = cleanRedirect(searchParams.redirect as string);
        searchParams.redirect = redirectUrl;
    }

    const defaultUser = searchParams.user as string | undefined;

    // Only use SmartLoginForm if NOT (OSS build OR org-only IdP enabled)
    const useSmartLogin =
        build === "saas" ||
        (build === "enterprise" && env.app.identityProviderMode === "org");

    let loginIdps: LoginFormIDP[] = [];
    if (!useSmartLogin) {
        // Load IdPs for DashboardLoginForm (OSS or org-only IdP mode)
        if (build === "oss" || env.app.identityProviderMode !== "org") {
            const idpsRes = await cache(
                async () =>
                    await priv.get<AxiosResponse<ListIdpsResponse>>("/idp")
            )();
            loginIdps = idpsRes.data.data.idps.map((idp) => ({
                idpId: idp.idpId,
                name: idp.name,
                variant: idp.type
            })) as LoginFormIDP[];
        }
    }

    const t = await getTranslations();

    return (
        <>
            {build === "saas" && (
                <p className="text-xs text-muted-foreground text-center mb-4">
                    {t.rich("loginLegalDisclaimer", {
                        termsOfService: (chunks) => (
                            <Link
                                href="https://pangolin.net/tos"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline"
                            >
                                {chunks}
                            </Link>
                        ),
                        privacyPolicy: (chunks) => (
                            <Link
                                href="https://pangolin.net/privacy"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline"
                            >
                                {chunks}
                            </Link>
                        )
                    })}
                </p>
            )}

            {isInvite && (
                <div className="border rounded-md p-3 mb-4 bg-card">
                    <div className="flex flex-col items-center">
                        <Mail className="w-12 h-12 mb-4 text-primary" />
                        <h2 className="text-2xl font-semibold mb-2 text-center">
                            {t("inviteAlready")}
                        </h2>
                        <p className="text-center">
                            {t("inviteAlreadyDescription")}
                        </p>
                    </div>
                </div>
            )}

            {useSmartLogin ? (
                <>
                    <Card className="w-full max-w-md">
                        <LoginCardHeader
                            subtitle={
                                forceLogin
                                    ? t("loginRequiredForDevice")
                                    : t("loginStart")
                            }
                        />
                        <CardContent className="pt-6">
                            <SmartLoginForm
                                redirect={redirectUrl}
                                forceLogin={forceLogin}
                                defaultUser={defaultUser}
                                orgSignIn={
                                    !isInvite &&
                                    (build === "saas" ||
                                        env.app.identityProviderMode === "org")
                                        ? {
                                              href: `/auth/org${buildQueryString(searchParams)}`,
                                              linkText: t("orgAuthSignInToOrg"),
                                              descriptionText:
                                                  t("needToSignInToOrg")
                                          }
                                        : undefined
                                }
                            />
                        </CardContent>
                    </Card>
                </>
            ) : (
                <DashboardLoginForm
                    redirect={redirectUrl}
                    idps={loginIdps}
                    forceLogin={forceLogin}
                    showOrgLogin={
                        !isInvite &&
                        (build === "saas" ||
                            env.app.identityProviderMode === "org")
                    }
                    searchParams={searchParams}
                    defaultUser={defaultUser}
                />
            )}

            {(!signUpDisabled || isInvite) && (
                <p className="text-center text-muted-foreground mt-4">
                    {t("authNoAccount")}{" "}
                    <Link
                        href={
                            !redirectUrl
                                ? `/auth/signup`
                                : `/auth/signup?redirect=${redirectUrl}`
                        }
                        className="underline"
                    >
                        {t("signup")}
                    </Link>
                </p>
            )}

            {!useSmartLogin &&
            !isInvite &&
            (build === "saas" || env.app.identityProviderMode === "org") ? (
                <OrgSignInLink
                    href={`/auth/org${buildQueryString(searchParams)}`}
                    linkText={t("orgAuthSignInToOrg")}
                    descriptionText={t("needToSignInToOrg")}
                />
            ) : null}
        </>
    );
}

function buildQueryString(searchParams: {
    [key: string]: string | string[] | undefined;
}): string {
    const params = new URLSearchParams();
    const redirect = searchParams.redirect;
    const forceLogin = searchParams.forceLogin;

    if (redirect && typeof redirect === "string") {
        params.set("redirect", redirect);
    }
    if (forceLogin && typeof forceLogin === "string") {
        params.set("forceLogin", forceLogin);
    }
    const queryString = params.toString();
    return queryString ? `?${queryString}` : "";
}
