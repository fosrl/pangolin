import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { AxiosResponse } from "axios";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import ResourceSessionsTable from "@app/components/ResourceSessionsTable";
import type { ListResourceSessionsResponse } from "@server/routers/resourceSession/types";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Resource Sessions"
};

type ResourceSessionsPageProps = {
    params: Promise<{ orgId: string }>;
};

export const dynamic = "force-dynamic";

export default async function ResourceSessionsPage(
    props: ResourceSessionsPageProps
) {
    const params = await props.params;

    // Fails with 403 when the org isn't licensed/subscribed; the
    // PaidFeaturesAlert below explains why the list is empty.
    let sessions: ListResourceSessionsResponse["sessions"] = [];
    try {
        const res = await internal.get<
            AxiosResponse<ListResourceSessionsResponse>
        >(`/org/${params.orgId}/resource-sessions`, await authCookieHeader());
        sessions = res.data.data.sessions;
    } catch (e) {}

    const t = await getTranslations();

    return (
        <>
            <SettingsSectionTitle
                title={t("resourceSessionsManage")}
                description={t("resourceSessionsDescription")}
            />

            <PaidFeaturesAlert tiers={tierMatrix.resourceSessions} />

            <ResourceSessionsTable sessions={sessions} orgId={params.orgId} />
        </>
    );
}
