import { RoleClientSettingsSettings } from "@app/components/RoleSettingsTabs";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { pullEnv } from "@app/lib/pullEnv";
import type { RoleClientSettingsValues } from "@server/routers/role/types";
import type { ListAllSiteResourcesByOrgResponse } from "@server/routers/siteResource";
import { AxiosResponse } from "axios";
import { redirect } from "next/navigation";

type PageProps = {
    params: Promise<{ orgId: string; roleId: string }>;
};

export default async function Page(props: PageProps) {
    const { orgId, roleId } = await props.params;
    if (pullEnv().flags.disableEnterpriseFeatures) {
        redirect(`/${orgId}/settings/access/roles/${roleId}/general`);
    }

    // Load on the server so the tab renders with the saved values instead of
    // the defaults. Either request fails when the org doesn't have the
    // feature; the tab then falls back to the defaults.
    const cookies = await authCookieHeader();
    const [settingsRes, gatewaysRes] = await Promise.all([
        internal
            .get<AxiosResponse<RoleClientSettingsValues>>(
                `/role/${roleId}/client-settings`,
                cookies
            )
            .catch(() => null),
        internal
            .get<AxiosResponse<ListAllSiteResourcesByOrgResponse>>(
                `/org/${orgId}/site-resources?mode=gateway&pageSize=10000`,
                cookies
            )
            .catch(() => null)
    ]);

    return (
        <RoleClientSettingsSettings
            initialSettings={settingsRes?.data.data}
            initialGateways={gatewaysRes?.data.data.siteResources}
        />
    );
}
