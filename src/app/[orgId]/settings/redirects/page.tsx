import RedirectsTable from "@app/components/RedirectsTable";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import type { ListRedirectsResponse } from "@server/routers/redirect";
import type { AxiosResponse } from "axios";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = {
    title: "Redirects"
};

type RedirectIndexPageProps = {
    params: Promise<{ orgId: string }>;
    searchParams: Promise<Record<string, string>>;
};

export const dynamic = "force-dynamic";

export default async function RedirectIndexPage(props: RedirectIndexPageProps) {
    const { orgId } = await props.params;
    const searchParams = new URLSearchParams(await props.searchParams);
    const t = await getTranslations();

    let redirects: ListRedirectsResponse["redirects"] = [];
    let pagination: ListRedirectsResponse["pagination"] = {
        total: 0,
        page: 1,
        pageSize: 20
    };

    try {
        const res = await internal.get<AxiosResponse<ListRedirectsResponse>>(
            `/org/${orgId}/redirects?${searchParams.toString()}`,
            await authCookieHeader()
        );
        const responseData = res.data.data;
        redirects = responseData.redirects;
        pagination = responseData.pagination;
    } catch {
        // empty list on error
    }

    return (
        <>
            <SettingsSectionTitle
                title={t("redirectsTitle")}
                description={t("redirectsDescription")}
            />

            <RedirectsTable
                orgId={orgId}
                redirects={redirects.map((redirect) => ({
                    redirectId: redirect.redirectId,
                    niceId: redirect.niceId,
                    name: redirect.name,
                    sourcePath: redirect.sourcePath,
                    destinationUrl: redirect.destinationUrl,
                    permanent: redirect.permanent,
                    enabled: redirect.enabled,
                    resourceId: redirect.resourceId,
                    resourceName: redirect.resourceName,
                    resourceNiceId: redirect.resourceNiceId,
                    resourceFullDomain: redirect.resourceFullDomain,
                    domainId: redirect.domainId,
                    baseDomain: redirect.baseDomain
                }))}
                rowCount={pagination.total}
                pagination={{
                    pageIndex: pagination.page - 1,
                    pageSize: pagination.pageSize
                }}
            />
        </>
    );
}
