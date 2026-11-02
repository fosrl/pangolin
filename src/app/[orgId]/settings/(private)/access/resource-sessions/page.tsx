import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { AxiosResponse } from "axios";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import ResourceSessionsTable from "@app/components/ResourceSessionsTable";
import type { SelectedResource } from "@app/components/resource-selector";
import type { SelectedUser } from "@app/components/user-selector";
import { getUserDisplayName } from "@app/lib/getUserDisplayName";
import type { ListResourceSessionsResponse } from "@server/routers/resourceSession/types";
import type { GetResourceResponse } from "@server/routers/resource/getResource";
import type { GetOrgUserResponse } from "@server/routers/user";
import type ResponseT from "@server/types/Response";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Resource Sessions"
};

type ResourceSessionsPageProps = {
    params: Promise<{ orgId: string }>;
    searchParams: Promise<Record<string, string>>;
};

export const dynamic = "force-dynamic";

function parsePositiveInt(value: string | null): number | undefined {
    if (!value) return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
    return parsed;
}

export default async function ResourceSessionsPage(
    props: ResourceSessionsPageProps
) {
    const { orgId } = await props.params;
    const searchParams = new URLSearchParams(await props.searchParams);
    const header = await authCookieHeader();

    // Fails with 403 when the org isn't licensed/subscribed; the
    // PaidFeaturesAlert below explains why the list is empty.
    let sessions: ListResourceSessionsResponse["sessions"] = [];
    let pagination: ListResourceSessionsResponse["pagination"] = {
        total: 0,
        page: 1,
        pageSize: 20
    };
    try {
        const res = await internal.get<
            AxiosResponse<ListResourceSessionsResponse>
        >(`/org/${orgId}/resource-sessions?${searchParams.toString()}`, header);
        sessions = res.data.data.sessions;
        pagination = res.data.data.pagination;
    } catch (e) {}

    const resourceIdParam = parsePositiveInt(searchParams.get("resourceId"));
    let initialFilterResource: SelectedResource | null = null;
    if (resourceIdParam) {
        try {
            const resourceRes = await internal.get(
                `/resource/${resourceIdParam}`,
                header
            );
            const resource = (
                resourceRes.data as ResponseT<GetResourceResponse>
            ).data;
            if (resource && resource.orgId === orgId) {
                initialFilterResource = {
                    name: resource.name,
                    resourceId: resource.resourceId,
                    fullDomain: resource.fullDomain,
                    niceId: resource.niceId,
                    ssl: resource.ssl,
                    wildcard: resource.wildcard
                };
            }
        } catch {
            // leave null so the table falls back to the id
        }
    }

    const userIdParam = searchParams.get("userId");
    let initialFilterUser: SelectedUser | null = null;
    if (userIdParam) {
        try {
            const userRes = await internal.get(
                `/org/${orgId}/user/${encodeURIComponent(userIdParam)}`,
                header
            );
            const user = (userRes.data as ResponseT<GetOrgUserResponse>).data;
            if (user) {
                initialFilterUser = {
                    id: userIdParam,
                    text: getUserDisplayName({
                        email: user.email,
                        name: user.name,
                        username: user.username
                    })
                };
            }
        } catch {
            // leave null so the table falls back to the id
        }
    }

    const t = await getTranslations();

    return (
        <>
            <SettingsSectionTitle
                title={t("resourceSessionsManage")}
                description={t("resourceSessionsDescription")}
            />

            <PaidFeaturesAlert tiers={tierMatrix.resourceSessions} />

            <ResourceSessionsTable
                orgId={orgId}
                sessions={sessions}
                rowCount={pagination.total}
                pagination={{
                    pageIndex: pagination.page - 1,
                    pageSize: pagination.pageSize
                }}
                initialFilterResource={initialFilterResource}
                initialFilterUser={initialFilterUser}
            />
        </>
    );
}
