import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { ListOrgLabelsResponse } from "@server/routers/labels/types";
import { AxiosResponse } from "axios";
import OrgLabelsTable from "@app/components/OrgLabelsTable";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = {
    title: "Labels"
};

type Props = {
    params: Promise<{ orgId: string }>;
    searchParams: Promise<Record<string, string>>;
};

export const dynamic = "force-dynamic";

export default async function LabelsPage({ params, searchParams }: Props) {
    const { orgId } = await params;

    const searchParamsObj = new URLSearchParams(await searchParams);

    let labels: ListOrgLabelsResponse["labels"] = [];
    let pagination: ListOrgLabelsResponse["pagination"] = {
        total: 0,
        page: 1,
        pageSize: 20
    };

    try {
        const res = await internal.get<AxiosResponse<ListOrgLabelsResponse>>(
            `/org/${orgId}/labels?${searchParamsObj.toString()}`,
            await authCookieHeader()
        );
        const responseData = res.data.data;
        labels = responseData.labels;
        pagination = responseData.pagination;
    } catch (e) {}

    const t = await getTranslations();

    return (
        <>
            <SettingsSectionTitle
                title={t("labels")}
                description={t("orgLabelsDescription")}
            />

            <PaidFeaturesAlert tiers={tierMatrix.labels} />

            <OrgLabelsTable
                labels={labels}
                orgId={orgId}
                rowCount={pagination.total}
                pagination={{
                    pageIndex: pagination.page - 1,
                    pageSize: pagination.pageSize
                }}
            />
        </>
    );
}
