import { Metadata } from "next";
import { TopbarNav } from "@app/components/TopbarNav";
import { KeyRound, Users } from "lucide-react";
import { verifySession } from "@app/lib/auth/verifySession";
import { redirect } from "next/navigation";
import { cache } from "react";
import UserProvider from "@app/providers/UserProvider";
import { ListUserOrgsResponse } from "@server/routers/org";
import { internal } from "@app/lib/api";
import { AxiosResponse } from "axios";
import { authCookieHeader } from "@app/lib/api/cookies";
import { Layout } from "@app/components/Layout";
import { adminNavSections } from "../navigation";
import { pullEnv } from "@app/lib/pullEnv";
import SubscriptionStatusProvider from "@app/providers/SubscriptionStatusProvider";
import { build } from "@server/build";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: `Server Admin - Pangolin`,
    description: ""
};

interface LayoutProps {
    children: React.ReactNode;
}

export default async function AdminLayout(props: LayoutProps) {
    const getUser = cache(verifySession);
    const user = await getUser();

    // Disable the admin page on saas
    if (build == "saas") {
        redirect(`/`);
    }

    const env = pullEnv();

    if (!user || !user.serverAdmin) {
        redirect(`/`);
    }

    const cookie = await authCookieHeader();
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

    return (
        <UserProvider user={user}>
            <SubscriptionStatusProvider
                subscriptionStatus={null}
                env={env.app.environment}
                sandbox_mode={env.app.sandbox_mode}
            >
                <Layout orgs={orgs} navItems={adminNavSections(env)}>
                    {props.children}
                </Layout>
            </SubscriptionStatusProvider>
        </UserProvider>
    );
}
