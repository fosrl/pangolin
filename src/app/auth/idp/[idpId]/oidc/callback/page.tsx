import { cookies, headers } from "next/headers";
import ValidateOidcToken from "@app/components/ValidateOidcToken";
import { cache } from "react";
import { formatAxiosError, priv } from "@app/lib/api";
import { AxiosResponse } from "axios";
import { GetIdpResponse } from "@server/routers/idp";
import { getTranslations } from "next-intl/server";
import { pullEnv } from "@app/lib/pullEnv";
import { LoadLoginPageResponse } from "@server/routers/loginPage/types";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Page(props: {
    params: Promise<{ orgId: string; idpId: string }>;
    searchParams: Promise<{
        code?: string;
        state?: string;
        error?: string;
        error_description?: string;
        error_uri?: string;
    }>;
}) {
    const params = await props.params;
    const searchParams = await props.searchParams;
    const t = await getTranslations();

    const allCookies = await cookies();
    const stateCookie = allCookies.get("p_oidc_state")?.value;

    const idpRes = await cache(
        async () =>
            await priv.get<AxiosResponse<GetIdpResponse>>(
                `/idp/${params.idpId}`
            )
    )();

    const foundIdp = idpRes.data?.data?.idp;

    if (!foundIdp) {
        return <div>{t("idpErrorNotFound")}</div>;
    }

    const allHeaders = await headers();
    const host = allHeaders.get("host");
    const env = pullEnv();
    const expectedHost = env.app.dashboardUrl.split("//")[1];
    let loginPage: LoadLoginPageResponse | undefined;
    if (host !== expectedHost) {
        try {
            const res = await priv.get<AxiosResponse<LoadLoginPageResponse>>(
                `/login-page?idpId=${foundIdp.idpId}&fullDomain=${host}`
            );

            if (res && res.status === 200) {
                loginPage = res.data.data;
            }
        } catch (e) {
            console.error(formatAxiosError(e));
        }

        if (!loginPage) {
            redirect(env.app.dashboardUrl);
        }
    }

    const providerError = searchParams.error
        ? {
              error: searchParams.error,
              description: searchParams.error_description,
              uri: searchParams.error_uri
          }
        : undefined;

    return (
        <>
            <ValidateOidcToken
                orgId={params.orgId}
                loginPageId={loginPage?.loginPageId}
                idpId={params.idpId}
                code={searchParams.code}
                expectedState={searchParams.state}
                stateCookie={stateCookie}
                idp={{ name: foundIdp.name }}
                providerError={providerError}
            />
        </>
    );
}
