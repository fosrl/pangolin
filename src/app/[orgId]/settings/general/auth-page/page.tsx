import AuthPageBrandingForm from "@app/components/AuthPageBrandingForm";
import AuthPageSettings from "@app/components/private/AuthPageSettings";
import { SettingsContainer } from "@app/components/Settings";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { getCachedSubscription } from "@app/lib/api/getCachedSubscription";
import { build } from "@server/build";
import type { GetOrgTierResponse } from "@server/routers/billing/types";
import {
    GetLoginPageBrandingResponse,
    GetLoginPageResponse
} from "@server/routers/loginPage/types";
import { AxiosResponse } from "axios";

export interface AuthPageProps {
    params: Promise<{ orgId: string }>;
}

export default async function AuthPage(props: AuthPageProps) {
    const orgId = (await props.params).orgId;
    let subscriptionStatus: GetOrgTierResponse | null = null;
    try {
        const subRes = await getCachedSubscription(orgId);
        subscriptionStatus = subRes.data.data;
    } catch {}

    let loginPage: GetLoginPageResponse | null = null;
    try {
        if (build === "saas") {
            const res = await internal.get<AxiosResponse<GetLoginPageResponse>>(
                `/org/${orgId}/login-page`,
                await authCookieHeader()
            );
            if (res.status === 200) {
                loginPage = res.data.data;
            }
        }
    } catch (error) {}

    let loginPageBranding: GetLoginPageBrandingResponse | null = null;
    try {
        const res = await internal.get<
            AxiosResponse<GetLoginPageBrandingResponse>
        >(`/org/${orgId}/login-page-branding`, await authCookieHeader());
        if (res.status === 200) {
            loginPageBranding = res.data.data;
        }
    } catch (error) {}

    return (
        <SettingsContainer>
            {build === "saas" && <AuthPageSettings loginPage={loginPage} />}
            <AuthPageBrandingForm orgId={orgId} branding={loginPageBranding} />
        </SettingsContainer>
    );
}
