import ResourcePoliciesBanner from "@app/components/ResourcePoliciesBanner";
import { ResourcePoliciesTable } from "@app/components/ResourcePoliciesTable";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { getCachedOrg } from "@app/lib/api/getCachedOrg";
import type { GetOrgResponse } from "@server/routers/org";
import type { ListResourcePoliciesResponse } from "@server/routers/resource/types";
import type { AxiosResponse } from "axios";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

export interface ResourcePoliciesPageProps {
    params: Promise<{ orgId: string }>;
    searchParams: Promise<Record<string, string>>;
}

export default async function ResourcePoliciesPage(
    props: ResourcePoliciesPageProps
) {
    const params = await props.params;
    const t = await getTranslations();
    const searchParams = new URLSearchParams(await props.searchParams);

    let org: GetOrgResponse | null = null;
    try {
        const res = await getCachedOrg(params.orgId);
        org = res.data.data;
    } catch {
        redirect(`/${params.orgId}/settings/resources`);
    }

    let policies: ListResourcePoliciesResponse["policies"] = [];
    let pagination: ListResourcePoliciesResponse["pagination"] = {
        total: 0,
        page: 1,
        pageSize: 20
    };
    try {
        const res = await internal.get<
            AxiosResponse<ListResourcePoliciesResponse>
        >(
            `/org/${params.orgId}/resource-policies?${searchParams.toString()}`,
            await authCookieHeader()
        );
        const responseData = res.data.data;
        policies = responseData.policies;
        pagination = responseData.pagination;
    } catch (e) {}

    return (
        <>
            <SettingsSectionTitle
                title={t("resourcePoliciesTitle")}
                description={t("resourcePoliciesDescription")}
            />

            <ResourcePoliciesBanner />

            <ResourcePoliciesTable
                policies={policies}
                orgId={params.orgId}
                rowCount={pagination.total}
                pagination={{
                    pageIndex: pagination.page - 1,
                    pageSize: pagination.pageSize
                }}
            />
        </>
    );
}
