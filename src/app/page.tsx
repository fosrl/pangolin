import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { verifySession } from "@app/lib/auth/verifySession";
import UserProvider from "@app/providers/UserProvider";
import { ListUserOrgsResponse } from "@server/routers/org";
import { AxiosResponse } from "axios";
import { redirect } from "next/navigation";
import OrganizationLanding from "@app/components/OrganizationLanding";
import { pullEnv } from "@app/lib/pullEnv";
import { cleanRedirect } from "@app/lib/cleanRedirect";
import { Layout } from "@app/components/Layout";
import RedirectToOrg from "@app/components/RedirectToOrg";
import { InitialSetupCompleteResponse } from "@server/routers/auth";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export default async function Page(props: {
    searchParams: Promise<{
        redirect: string | undefined;
        t: string | undefined;
        orgs?: string | undefined;
    }>;
}) {
    const params = await props.searchParams; // this is needed to prevent static optimization
    const showOrgPicker = params.orgs === "1";

    const env = pullEnv();

    const user = await verifySession({ skipCheckVerifyEmail: true });

    let complete: boolean | null = null; // null means "unknown" (request errored)
    try {
        const setupRes = await internal.get<
            AxiosResponse<InitialSetupCompleteResponse>
        >(`/auth/initial-setup-complete`, await authCookieHeader());
        complete = setupRes.data.data.complete;
    } catch (e) {
        // Swallow errors (e.g. 429 rate limit, 500, network failure).
        // Only redirect to initial-setup when the server *confirms* setup
        // is incomplete (complete === false). If the request itself failed we
        // cannot tell, so fall through to the login redirect instead.
    }
    if (complete === false) {
        redirect("/auth/initial-setup");
    }

    if (!user) {
        if (params.redirect) {
            const safe = cleanRedirect(params.redirect);
            redirect(`/auth/login?redirect=${safe}`);
        } else {
            redirect(`/auth/login`);
        }
    }

    if (!user.emailVerified && env.flags.emailVerificationRequired) {
        if (params.redirect) {
            const safe = cleanRedirect(params.redirect);
            redirect(`/auth/verify-email?redirect=${safe}`);
        } else {
            redirect(`/auth/verify-email`);
        }
    }

    let orgs: ListUserOrgsResponse["orgs"] = [];
    try {
        const res = await internal.get<AxiosResponse<ListUserOrgsResponse>>(
            `/user/${user.userId}/orgs`,
            await authCookieHeader()
        );

        if (res && res.data.data.orgs) {
            orgs = res.data.data.orgs;
        }
    } catch (e) {}

    if (!orgs.length) {
        if (!env.flags.disableUserCreateOrg || user.serverAdmin) {
            redirect("/setup?firstOrg");
        }
    }

    const allCookies = await cookies();
    const lastOrgCookie = allCookies.get("pangolin-last-org")?.value;

    const lastOrgExists = orgs.some((org) => org.orgId === lastOrgCookie);
    let targetOrgId: string | null = null;
    if (lastOrgExists && lastOrgCookie) {
        targetOrgId = lastOrgCookie;
    } else {
        let ownedOrg = orgs.find((org) => org.isOwner);
        const primaryOrg = orgs.find((org) => org.isPrimaryOrg);
        if (!ownedOrg) {
            if (primaryOrg) {
                ownedOrg = primaryOrg;
            } else {
                ownedOrg = orgs[0];
            }
        }
        if (!ownedOrg) {
            ownedOrg = orgs[0];
        }
        if (ownedOrg) {
            targetOrgId = ownedOrg.orgId;
        } else {
            if (!env.flags.disableUserCreateOrg || user.serverAdmin) {
                redirect("/setup");
            }
        }
    }

    if (targetOrgId && !showOrgPicker) {
        const targetOrg = orgs.find((org) => org.orgId === targetOrgId);
        return (
            <RedirectToOrg
                targetOrgId={targetOrgId}
                isAdminOrOwner={Boolean(
                    targetOrg?.isAdmin || targetOrg?.isOwner
                )}
            />
        );
    }

    return (
        <UserProvider user={user}>
            <Layout orgs={orgs} navItems={[]}>
                <div className="w-full max-w-md mx-auto md:mt-32 mt-4">
                    <OrganizationLanding
                        disableCreateOrg={
                            env.flags.disableUserCreateOrg && !user.serverAdmin
                        }
                        organizations={orgs.map((org) => ({
                            name: org.name,
                            id: org.orgId
                        }))}
                    />
                </div>
            </Layout>
        </UserProvider>
    );
}
