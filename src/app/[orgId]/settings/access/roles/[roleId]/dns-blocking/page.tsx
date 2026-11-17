import { RoleDnsBlockingSettings } from "@app/components/RoleSettingsTabs";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import type { RoleDnsBlockingValues } from "@server/routers/dnsBlocking/types";
import { AxiosResponse } from "axios";

type PageProps = {
    params: Promise<{ orgId: string; roleId: string }>;
};

export default async function Page(props: PageProps) {
    const { roleId } = await props.params;

    // Load on the server so the tab renders with the saved values instead of
    // the defaults.
    const res = await internal
        .get<AxiosResponse<RoleDnsBlockingValues>>(
            `/role/${roleId}/dns-blocking`,
            await authCookieHeader()
        )
        .catch(() => null);

    return <RoleDnsBlockingSettings initialValues={res?.data.data} />;
}
