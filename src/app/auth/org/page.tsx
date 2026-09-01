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
import { GetSessionTransferTokenRenponse } from "@server/routers/auth/types";
import ValidateSessionTransferToken from "@app/components/ValidateSessionTransferToken";
import { isOrgSubscribed } from "@app/lib/api/isOrgSubscribed";
import { OrgSelectionForm } from "@app/components/OrgSelectionForm";
import OrgLoginPage from "@app/components/OrgLoginPage";
import type { Metadata } from "next";
import { tierMatrix } from "@server/lib/billing/tierMatrix";

export const metadata: Metadata = {
    title: "Choose Organization"
};

export const dynamic = "force-dynamic";

export default async function OrgAuthPage(props: {
    params: Promise<{}>;
    searchParams: Promise<{
        token?: string;
        redirect?: string;
        forceLogin?: string;
    }>;
}) {
    const searchParams = await props.searchParams;
    const forceLoginParam = searchParams.forceLogin;
    const forceLogin = forceLoginParam === "true";

    const env = pullEnv();

    if (build !== "saas" && env.app.identityProviderMode !== "org") {
        redirect("/");
    }

    const authHeader = await authCookieHeader();

    if (searchParams.token) {
        return (
            <ValidateSessionTransferToken
                token={searchParams.token}
                redirect={searchParams.redirect}
            />
        );
    }

    const getUser = cache(verifySession);
    const user = await getUser({ skipCheckVerifyEmail: true });

    const allHeaders = await headers();
    const host = allHeaders.get("host");

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

        const subscribed = await isOrgSubscribed(
            loginPage.orgId,
            tierMatrix.loginPageDomain
        );

        if (build === "saas" && !subscribed) {
            console.log(
                `Org ${loginPage.orgId} is not subscribed, redirecting to dashboard`
            );
            redirect(env.app.dashboardUrl);
        }

        if (user && !forceLogin) {
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
                // redirectToUrl = `${env.app.dashboardUrl}/auth/org?token=${redirectToken}`;
                // include redirect param if exists
                redirectToUrl = `${env.app.dashboardUrl}/auth/org?token=${redirectToken}${
                    searchParams.redirect
                        ? `&redirect=${encodeURIComponent(
                              searchParams.redirect
                          )}`
                        : ""
                }`;
                console.log(
                    `Redirecting logged in user to org auth callback: ${redirectToUrl}`
                );
                redirect(redirectToUrl);
            }
        }
    } else {
        return <OrgSelectionForm />;
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
        <OrgLoginPage
            loginPage={loginPage}
            loginIdps={loginIdps}
            branding={branding}
            searchParams={searchParams}
        />
    );
}
