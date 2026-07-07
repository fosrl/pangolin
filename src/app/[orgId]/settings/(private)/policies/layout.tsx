import { getCachedOrg } from "@app/lib/api/getCachedOrg";
import OrgProvider from "@app/providers/OrgProvider";
import type { GetOrgResponse } from "@server/routers/org";
import { redirect } from "next/navigation";

export interface PolicyLayoutPageProps {
    params: Promise<{ orgId: string }>;
    children: React.ReactNode;
}

export default async function PolicyLayoutPage(props: PolicyLayoutPageProps) {
    const params = await props.params;

    let org: GetOrgResponse | null = null;
    try {
        const res = await getCachedOrg(params.orgId);
        org = res.data.data;
    } catch {
        redirect(`/${params.orgId}/settings`);
    }

    return <OrgProvider org={org}>{props.children}</OrgProvider>;
}
