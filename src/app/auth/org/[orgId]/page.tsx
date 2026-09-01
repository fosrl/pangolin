import { priv } from "@app/lib/api";
import { AxiosResponse } from "axios";
import { cache } from "react";
import { verifySession } from "@app/lib/auth/verifySession";
import { LoginFormIDP } from "@app/components/LoginForm";
import { ListOrgIdpsResponse } from "@server/routers/orgIdp/types";
import { build } from "@server/build";
import {
    LoadLoginPageBrandingResponse,
    LoadLoginPageResponse
} from "@server/routers/loginPage/types";
import { redirect } from "next/navigation";
import OrgLoginPage from "@app/components/OrgLoginPage";
import { pullEnv } from "@app/lib/pullEnv";
import type { Metadata } from "next";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { isOrgSubscribed } from "@app/lib/api/isOrgSubscribed";

export const metadata: Metadata = {
    title: "Organization Login"
};

export const dynamic = "force-dynamic";

export default async function OrgAuthPage(props: {
    params: Promise<{ orgId: string }>;
    searchParams: Promise<{ forceLogin?: string; redirect?: string }>;
}) {
    const searchParams = await props.searchParams;
    const params = await props.params;

    const env = pullEnv();

    if (build !== "saas" && env.app.identityProviderMode !== "org") {
        const queryString = new URLSearchParams(searchParams as any).toString();
        redirect(`/auth/login${queryString ? `?${queryString}` : ""}`);
    }

    const forceLoginParam = searchParams?.forceLogin;
    const forceLogin = forceLoginParam === "true";
    const orgId = params.orgId;

    const getUser = cache(verifySession);
    const user = await getUser({ skipCheckVerifyEmail: true });

    if (user && !forceLogin) {
        redirect("/");
    }

    let loginPage: LoadLoginPageResponse | undefined;

    try {
        const res = await priv.get<AxiosResponse<LoadLoginPageResponse>>(
            `/login-page?orgId=${orgId}`
        );

        if (res && res.status === 200) {
            loginPage = res.data.data;
        }
    } catch (e) {}

    let loginIdps: LoginFormIDP[] = [];
    const idpsRes = await priv.get<AxiosResponse<ListOrgIdpsResponse>>(
        `/org/${orgId}/idp`
    );

    loginIdps = idpsRes.data.data.idps.map((idp) => ({
        idpId: idp.idpId,
        name: idp.name,
        variant: idp.variant
    })) as LoginFormIDP[];

    const hasLoginPageBranding = await isOrgSubscribed(
        orgId,
        tierMatrix.loginPageBranding
    );

    let branding: LoadLoginPageBrandingResponse | null = null;
    if (hasLoginPageBranding) {
        try {
            const res = await priv.get<
                AxiosResponse<LoadLoginPageBrandingResponse>
            >(`/login-page-branding?orgId=${orgId}`);
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
