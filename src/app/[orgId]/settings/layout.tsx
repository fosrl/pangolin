import { Metadata } from "next";

import { verifySession } from "@app/lib/auth/verifySession";
import { redirect } from "next/navigation";
import { internal } from "@app/lib/api";
import { AxiosResponse } from "axios";
import { ListUserOrgsResponse } from "@server/routers/org";
import { authCookieHeader } from "@app/lib/api/cookies";
import { cache } from "react";
import { GetOrgUserResponse } from "@server/routers/user";
import UserProvider from "@app/providers/UserProvider";
import { Layout } from "@app/components/Layout";
import { getTranslations } from "next-intl/server";
import { pullEnv } from "@app/lib/pullEnv";
import { orgNavSections } from "@app/app/navigation";
import { getCachedOrgUser } from "@app/lib/api/getCachedOrgUser";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: {
        template: `%s - ${process.env.BRANDING_APP_NAME || "Pangolin"}`,
        default: `Settings - ${process.env.BRANDING_APP_NAME || "Pangolin"}`
    },
    description: ""
};

interface SettingsLayoutProps {
    children: React.ReactNode;
    params: Promise<{ orgId: string }>;
}

export default async function SettingsLayout(props: SettingsLayoutProps) {
    const params = await props.params;

    const { children } = props;

    const getUser = cache(verifySession);
    const user = await getUser();

    const env = pullEnv();

    if (!user) {
        redirect(`/`);
    }

    const cookie = await authCookieHeader();

    const t = await getTranslations();

    try {
        const orgUser = await getCachedOrgUser(params.orgId, user.userId);

        if (!orgUser.data.data.isAdmin && !orgUser.data.data.isOwner) {
            throw new Error(t("userErrorNotAdminOrOwner"));
        }
    } catch {
        redirect(`/${params.orgId}`);
    }

    let orgs: ListUserOrgsResponse["orgs"] = [];
    try {
        const getOrgs = cache(() =>
            internal.get<AxiosResponse<ListUserOrgsResponse>>(
                `/user/${user.userId}/orgs`,
                cookie
            )
        );
        const res = await getOrgs();
        if (res && res.data.data.orgs) {
            orgs = res.data.data.orgs;
        }
    } catch (e) {}

    const primaryOrg = orgs.find((o) => o.orgId === params.orgId)?.isPrimaryOrg;

    return (
        <UserProvider user={user}>
            <Layout
                orgId={params.orgId}
                orgs={orgs}
                navItems={orgNavSections(env, {
                    isPrimaryOrg: primaryOrg
                })}
            >
                {children}
            </Layout>
        </UserProvider>
    );
}
