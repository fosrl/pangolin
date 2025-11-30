import { formatAxiosError, internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { verifySession } from "@app/lib/auth/verifySession";
import {
    CheckOrgUserAccessResponse,
    GetOrgResponse,
    ListUserOrgsResponse
} from "@server/routers/org";
import { GetOrgUserResponse } from "@server/routers/user";
import { AxiosResponse } from "axios";
import { redirect } from "next/navigation";
import { cache } from "react";
import SetLastOrgCookie from "@app/components/SetLastOrgCookie";
import SubscriptionStatusProvider from "@app/providers/SubscriptionStatusProvider";
import { GetOrgSubscriptionResponse } from "@server/routers/billing/types";
import { pullEnv } from "@app/lib/pullEnv";
import { build } from "@server/build";
import OrgPolicyResult from "@app/components/OrgPolicyResult";
import UserProvider from "@app/providers/UserProvider";
import { Layout } from "@app/components/Layout";

export default async function OrgLayout(props: {
    children: React.ReactNode;
    params: Promise<{ orgId: string }>;
}) {
    const cookie = await authCookieHeader();
    const params = await props.params;
    const orgId = params.orgId;
    const env = pullEnv();

    if (!orgId) {
        redirect(`/`);
    }

    const getUser = cache(verifySession);
    const user = await getUser();

    if (!user) {
        redirect(`/`);
    }

    let accessRes: CheckOrgUserAccessResponse | null = null;
    try {
        const checkOrgAccess = cache(() =>
            internal.get<AxiosResponse<CheckOrgUserAccessResponse>>(
                `/org/${orgId}/user/${user.userId}/check`,
                cookie
            )
        );
        const res = await checkOrgAccess();
        accessRes = res.data.data;
    } catch (e) {
        redirect(`/`);
    }

    if (!accessRes?.allowed) {
        // For non-admin users, show the member resources portal
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
        return (
            <UserProvider user={user}>
                <Layout orgId={orgId} navItems={[]} orgs={orgs}>
                    <OrgPolicyResult
                        orgId={orgId}
                        userId={user.userId}
                        accessRes={accessRes}
                    />
                </Layout>
            </UserProvider>
        );
    }

    let subscriptionStatus = null;
    if (build === "saas") {
        try {
            const getSubscription = cache(() =>
                internal.get<AxiosResponse<GetOrgSubscriptionResponse>>(
                    `/org/${orgId}/billing/subscription`,
                    cookie
                )
            );
            const subRes = await getSubscription();
            subscriptionStatus = subRes.data.data;
        } catch (error) {
            // If subscription fetch fails, keep subscriptionStatus as null
            console.error("Failed to fetch subscription status:", error);
        }
    }

    return (
        <SubscriptionStatusProvider
            subscriptionStatus={subscriptionStatus}
            env={env.app.environment}
            sandbox_mode={env.app.sandbox_mode}
        >
            {props.children}
            <SetLastOrgCookie orgId={orgId} />
        </SubscriptionStatusProvider>
    );
}
