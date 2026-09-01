import { Layout } from "@app/components/Layout";
import UserVirtualApiKeys from "@app/components/UserVirtualApiKeys";
import { commandBarNavSections } from "@app/app/navigation";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { verifySession } from "@app/lib/auth/verifySession";
import { pullEnv } from "@app/lib/pullEnv";
import UserProvider from "@app/providers/UserProvider";
import { ListUserOrgsResponse } from "@server/routers/org";
import { GetOrgOverviewResponse } from "@server/routers/org/getOrgOverview";
import type { ListMyVirtualApiKeysResponse } from "@server/routers/virtualApiKey/types";
import { AxiosResponse } from "axios";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { cache } from "react";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations();
    return {
        title: t("myVirtualApiKeysTitle")
    };
}

type ResourceKeysPageProps = {
    params: Promise<{ orgId: string; resourceGuid: string }>;
};

export const dynamic = "force-dynamic";

export default async function ResourceKeysPage(props: ResourceKeysPageProps) {
    const params = await props.params;
    const orgId = params.orgId;
    const resourceGuid = params.resourceGuid;

    if (!orgId || !resourceGuid) {
        redirect(`/`);
    }

    const getUser = cache(verifySession);
    const user = await getUser();

    if (!user) {
        redirect(
            `/auth/resource/${encodeURIComponent(resourceGuid)}?redirect=${encodeURIComponent(`/${orgId}/resource/${resourceGuid}/keys`)}`
        );
    }

    const cookieHeader = await authCookieHeader();

    let overview: GetOrgOverviewResponse | undefined;
    try {
        const res = await internal.get<AxiosResponse<GetOrgOverviewResponse>>(
            `/org/${orgId}/overview`,
            cookieHeader
        );
        overview = res.data.data;
    } catch {
        // leave undefined
    }

    let orgs: ListUserOrgsResponse["orgs"] = [];
    try {
        const getOrgs = cache(async () =>
            internal.get<AxiosResponse<ListUserOrgsResponse>>(
                `/user/${user.userId}/orgs`,
                cookieHeader
            )
        );
        const res = await getOrgs();
        if (res && res.data.data.orgs) {
            orgs = res.data.data.orgs;
        }
    } catch {
        // leave empty
    }

    if (!orgs.some((org) => org.orgId === orgId)) {
        redirect("/");
    }

    let keysData: ListMyVirtualApiKeysResponse | null = null;
    try {
        const res = await internal.get<
            AxiosResponse<ListMyVirtualApiKeysResponse>
        >(
            `/org/${orgId}/my-virtual-api-keys?resourceGuid=${encodeURIComponent(resourceGuid)}`,
            cookieHeader
        );
        keysData = res.data.data;
    } catch {
        redirect(`/${orgId}/keys`);
    }

    if (!keysData) {
        redirect(`/${orgId}/keys`);
    }

    const env = pullEnv();
    const primaryOrg = orgs.find((o) => o.orgId === orgId)?.isPrimaryOrg;
    const isAdminOrOwner = Boolean(overview?.isAdmin || overview?.isOwner);

    return (
        <UserProvider user={user}>
            <Layout
                orgId={orgId}
                orgs={orgs}
                navItems={[]}
                commandNavItems={commandBarNavSections(env, {
                    isPrimaryOrg: primaryOrg
                })}
                showSidebar={false}
                launcherMode
                showViewAsAdmin={isAdminOrOwner}
            >
                <UserVirtualApiKeys
                    orgId={orgId}
                    initialData={keysData}
                    resourceNiceId={keysData.resourceNiceId ?? undefined}
                    endpoint={keysData.resourceAccessUrl ?? undefined}
                />
            </Layout>
        </UserProvider>
    );
}
