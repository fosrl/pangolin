import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import OrgsTable from "@app/components/OrgsTable";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import type { AdminListOrgsResponse } from "@server/routers/org";
import type { AxiosResponse } from "axios";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = {
    title: "Organizations"
};

export const dynamic = "force-dynamic";

type OrganizationsPageProps = {
    searchParams: Promise<Record<string, string>>;
};

export default async function OrganizationsPage(props: OrganizationsPageProps) {
    const searchParams = new URLSearchParams(await props.searchParams);

    let orgs: AdminListOrgsResponse["orgs"] = [];
    let pagination: AdminListOrgsResponse["pagination"] = {
        total: 0,
        page: 1,
        pageSize: 20
    };

    try {
        const res = await internal.get<AxiosResponse<AdminListOrgsResponse>>(
            `/admin/orgs?${searchParams.toString()}`,
            await authCookieHeader()
        );
        const responseData = res.data.data;
        orgs = responseData.orgs;
        pagination = responseData.pagination;
    } catch (e) {}

    const t = await getTranslations();

    return (
        <>
            <SettingsSectionTitle
                title={t("orgsManage")}
                description={t("orgsDescription")}
            />

            <OrgsTable
                orgs={orgs}
                rowCount={pagination.total}
                pagination={{
                    pageIndex: pagination.page - 1,
                    pageSize: pagination.pageSize
                }}
            />
        </>
    );
}
