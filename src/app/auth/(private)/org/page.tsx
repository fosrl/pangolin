import { formatAxiosError, priv } from "@app/lib/api";
import { AxiosResponse } from "axios";
import { authCookieHeader } from "@app/lib/api/cookies";
import { cache } from "react";
import { verifySession } from "@app/lib/auth/verifySession";
import { redirect } from "next/navigation";
import { pullEnv } from "@app/lib/pullEnv";
import { LoginFormIDP } from "@app/components/LoginForm";
import { ListOrgIdpsResponse } from "@server/routers/orgIdp/types";
import { build } from "@server/build";
import { headers } from "next/headers";
import {
    LoadLoginPageBrandingResponse,
    LoadLoginPageResponse
} from "@server/routers/loginPage/types";
import IdpLoginButtons from "@app/components/private/IdpLoginButtons";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from "@app/components/ui/card";
import { Button } from "@app/components/ui/button";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { GetSessionTransferTokenRenponse } from "@server/routers/auth/types";
import ValidateSessionTransferToken from "@app/components/private/ValidateSessionTransferToken";
import { replacePlaceholder } from "@app/lib/replacePlaceholder";
import { isOrgSubscribed } from "@app/lib/api/isOrgSubscribed";

export const dynamic = "force-dynamic";

export default async function OrgAuthPage(props: {
    params: Promise<{}>;
    searchParams: Promise<{ token?: string }>;
}) {
    const searchParams = await props.searchParams;

    const env = pullEnv();

    const authHeader = await authCookieHeader();

    if (searchParams.token) {
        return <ValidateSessionTransferToken token={searchParams.token} />;
    }

    const getUser = cache(verifySession);
    const user = await getUser({ skipCheckVerifyEmail: true });

    const allHeaders = await headers();
    const host = allHeaders.get("host");

    const t = await getTranslations();

    const expectedHost = env.app.dashboardUrl.split("//")[1];

    let redirectToUrl: string | undefined;
    let loginPage: LoadLoginPageResponse | undefined;
    if (host !== expectedHost) {
        try {
            const res = await priv.get<AxiosResponse<LoadLoginPageResponse>>(
                `/login-page?fullDomain=${host}`
            );

            if (res && res.status === 200) {
                loginPage = res.data.data;
            }
        } catch (e) {}

        if (!loginPage) {
            console.debug(
                `No login page found for host ${host}, redirecting to dashboard`
            );
            redirect(env.app.dashboardUrl);
        }

        const subscribed = await isOrgSubscribed(loginPage.orgId);

        if (build === "saas" && !subscribed) {
            console.log(
                `Org ${loginPage.orgId} is not subscribed, redirecting to dashboard`
            );
            redirect(env.app.dashboardUrl);
        }

        if (user) {
            let redirectToken: string | undefined;
            try {
                const res = await priv.post<
                    AxiosResponse<GetSessionTransferTokenRenponse>
                >(`/get-session-transfer-token`, {}, authHeader);

                if (res && res.status === 200) {
                    const newToken = res.data.data.token;
                    redirectToken = newToken;
                }
            } catch (e) {
                console.error(
                    formatAxiosError(e, "Failed to get transfer token")
                );
            }

            if (redirectToken) {
                redirectToUrl = `${env.app.dashboardUrl}/auth/org?token=${redirectToken}`;
                redirect(redirectToUrl);
            }
        }
    } else {
        console.log(`Host ${host} is the same`);
        redirect(env.app.dashboardUrl);
    }

    let loginIdps: LoginFormIDP[] = [];
    if (build === "saas") {
        const idpsRes = await priv.get<AxiosResponse<ListOrgIdpsResponse>>(
            `/org/${loginPage.orgId}/idp`
        );

        loginIdps = idpsRes.data.data.idps.map((idp) => ({
            idpId: idp.idpId,
            name: idp.name,
            variant: idp.variant
        })) as LoginFormIDP[];
    }

    let branding: LoadLoginPageBrandingResponse | null = null;
    if (build === "saas") {
        try {
            const res = await priv.get<
                AxiosResponse<LoadLoginPageBrandingResponse>
            >(`/login-page-branding?orgId=${loginPage.orgId}`);
            if (res.status === 200) {
                branding = res.data.data;
            }
        } catch (error) {}
    }

    return (
        <div>
            <div className="text-center mb-2">
                <span className="text-sm text-muted-foreground">
                    {t("poweredBy")}{" "}
                    <Link
                        href="https://pangolin.net/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                    >
                        {env.branding.appName || "Pangolin"}
                    </Link>
                </span>
            </div>
            <Card className="w-full max-w-md">
                <CardHeader>
                    {branding?.logoUrl && (
                        <div className="flex flex-row items-center justify-center mb-3">
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
                        />
                    ) : (
                        <div className="space-y-4">
                            <p className="text-sm text-muted-foreground">
                                {t("orgAuthNoIdpConfigured")}
                            </p>
                            <Link href={`${env.app.dashboardUrl}/auth/login`}>
                                <Button className="w-full">
                                    {t("orgAuthSignInWithPangolin")}
                                </Button>
                            </Link>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
