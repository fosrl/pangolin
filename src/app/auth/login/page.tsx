import { verifySession } from "@app/lib/auth/verifySession";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cache } from "react";
import DashboardLoginForm from "@app/components/DashboardLoginForm";
import { Mail } from "lucide-react";
import { pullEnv } from "@app/lib/pullEnv";
import { cleanRedirect } from "@app/lib/cleanRedirect";
import { idp } from "@server/db";
import { LoginFormIDP } from "@app/components/LoginForm";
import { priv } from "@app/lib/api";
import { AxiosResponse } from "axios";
import { ListIdpsResponse } from "@server/routers/idp";
import { getTranslations } from "next-intl/server";
import { build } from "@server/build";
import { LoadLoginPageResponse } from "@server/routers/loginPage/types";

export const dynamic = "force-dynamic";

export default async function Page(props: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
    const searchParams = await props.searchParams;
    const getUser = cache(verifySession);
    const user = await getUser({ skipCheckVerifyEmail: true });

    const isInvite = searchParams?.redirect?.includes("/invite");

    const env = pullEnv();

    const signUpDisabled = env.flags.disableSignupWithoutInvite;

    if (user) {
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
    }

    let loginIdps: LoginFormIDP[] = [];
    if (build !== "saas") {
        const idpsRes = await cache(
            async () => await priv.get<AxiosResponse<ListIdpsResponse>>("/idp")
        )();
        loginIdps = idpsRes.data.data.idps.map((idp) => ({
            idpId: idp.idpId,
            name: idp.name,
            variant: idp.type
        })) as LoginFormIDP[];
    }

    const t = await getTranslations();

    return (
        <>
            {isInvite && (
                <div className="border rounded-md p-3 mb-4 bg-card">
                    <div className="flex flex-col items-center">
                        <Mail className="w-12 h-12 mb-4 text-primary" />
                        <h2 className="text-2xl font-bold mb-2 text-center">
                            {t("inviteAlready")}
                        </h2>
                        <p className="text-center">
                            {t("inviteAlreadyDescription")}
                        </p>
                    </div>
                </div>
            )}

            <DashboardLoginForm redirect={redirectUrl} idps={loginIdps} />

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
        </>
    );
}
