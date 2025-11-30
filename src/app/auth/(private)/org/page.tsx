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
import { GetOrgTierResponse } from "@server/routers/billing/types";
import { TierId } from "@server/lib/billing/tiers";

export const dynamic = "force-dynamic";

export default async function OrgAuthPage(props: {
    params: Promise<{}>;
    searchParams: Promise<{ token?: string }>;
}) {
    const params = await props.params;
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

        let subscriptionStatus: GetOrgTierResponse | null = null;
        if (build === "saas") {
            try {
                const getSubscription = cache(() =>
                    priv.get<AxiosResponse<GetOrgTierResponse>>(
                        `/org/${loginPage!.orgId}/billing/tier`
                    )
                );
                const subRes = await getSubscription();
                subscriptionStatus = subRes.data.data;
            } catch {}
        }
        const subscribed =
            build === "enterprise"
                ? true
                : subscriptionStatus?.tier === TierId.STANDARD;

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
        const idpsRes = await cache(
            async () =>
                await priv.get<AxiosResponse<ListOrgIdpsResponse>>(
                    `/org/${loginPage!.orgId}/idp`
                )
        )();
        loginIdps = idpsRes.data.data.idps.map((idp) => ({
            idpId: idp.idpId,
            name: idp.name,
            variant: idp.variant
        })) as LoginFormIDP[];
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
            <Card className="shadow-md w-full max-w-md">
                <CardHeader>
                    <CardTitle>{t("orgAuthSignInTitle")}</CardTitle>
                    <CardDescription>
                        {loginIdps.length > 0
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
