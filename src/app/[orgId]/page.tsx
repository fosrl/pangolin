import { Layout } from "@app/components/Layout";
import ResourceLauncher from "@app/components/resource-launcher/ResourceLauncher";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { fetchLauncherPageData } from "@app/lib/launcherServerData";
import { verifySession } from "@app/lib/auth/verifySession";
import UserProvider from "@app/providers/UserProvider";
import { ListUserOrgsResponse } from "@server/routers/org";
import { GetOrgOverviewResponse } from "@server/routers/org/getOrgOverview";
import { AxiosResponse } from "axios";
import { redirect } from "next/navigation";
import { cache } from "react";

type OrgPageProps = {
    params: Promise<{ orgId: string }>;
    searchParams: Promise<Record<string, string>>;
};

export const dynamic = "force-dynamic";

export default async function OrgPage(props: OrgPageProps) {
    const params = await props.params;
    const orgId = params.orgId;

    if (!orgId) {
        redirect(`/`);
    }

    const getUser = cache(verifySession);
    const user = await getUser();

    if (!user) {
        redirect("/");
    }

    let overview: GetOrgOverviewResponse | undefined;
    try {
        const res = await internal.get<AxiosResponse<GetOrgOverviewResponse>>(
            `/org/${orgId}/overview`,
            await authCookieHeader()
        );
        overview = res.data.data;
    } catch (e) {}

    let orgs: ListUserOrgsResponse["orgs"] = [];
    try {
        const getOrgs = cache(async () =>
            internal.get<AxiosResponse<ListUserOrgsResponse>>(
                `/user/${user.userId}/orgs`,
                await authCookieHeader()
            )
        );
        const res = await getOrgs();
        if (res && res.data.data.orgs) {
            orgs = res.data.data.orgs;
        }
    } catch (e) {}

    const isAdminOrOwner = Boolean(overview?.isAdmin || overview?.isOwner);

    const searchParams = new URLSearchParams(await props.searchParams);
    const launcherData = overview
        ? await fetchLauncherPageData(
              orgId,
              searchParams,
              await authCookieHeader()
          )
        : null;

    return (
        <UserProvider user={user}>
            <Layout
                orgId={orgId}
                orgs={orgs}
                navItems={[]}
                showSidebar={false}
                launcherMode
                showViewAsAdmin={isAdminOrOwner}
            >
                {overview && launcherData ? (
                    <ResourceLauncher
                        orgId={orgId}
                        isAdmin={isAdminOrOwner}
                        views={launcherData.views}
                        defaultViewOverrides={launcherData.defaultViewOverrides}
                        activeViewId={launcherData.activeViewId}
                        config={launcherData.config}
                        savedConfig={launcherData.savedConfig}
                        scale={launcherData.scale}
                        groups={launcherData.groups}
                        groupsPagination={launcherData.groupsPagination}
                    />
                ) : null}
            </Layout>
        </UserProvider>
    );
}
