import { priv } from "@app/lib/api";
import { isOrgSubscribed } from "@app/lib/api/isOrgSubscribed";
import { build } from "@server/build";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { LoadLoginPageBrandingResponse } from "@server/routers/loginPage/types";
import { AxiosResponse } from "axios";

export async function loadOrgLoginPageBranding(orgId: string): Promise<{
    primaryColor: string | null;
}> {
    if (build === "oss") {
        return { primaryColor: null };
    }

    const subscribed = await isOrgSubscribed(
        orgId,
        tierMatrix.loginPageBranding
    );
    if (!subscribed) {
        return { primaryColor: null };
    }

    try {
        const res = await priv.get<
            AxiosResponse<LoadLoginPageBrandingResponse>
        >(`/login-page-branding?orgId=${orgId}`);
        if (res.status === 200) {
            return { primaryColor: res.data.data.primaryColor ?? null };
        }
    } catch {
        // ignore
    }

    return { primaryColor: null };
}
