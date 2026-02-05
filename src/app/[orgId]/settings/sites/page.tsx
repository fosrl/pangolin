import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { ListSitesResponse } from "@server/routers/site";
import { AxiosResponse } from "axios";
import SitesTable, { SiteRow } from "@app/components/SitesTable";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import SitesBanner from "@app/components/SitesBanner";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = {
    title: "Sites"
};

type SitesPageProps = {
    params: Promise<{ orgId: string }>;
    searchParams: Promise<Record<string, string>>;
};

export const dynamic = "force-dynamic";

export default async function SitesPage(props: SitesPageProps) {
    const params = await props.params;

    const searchParams = new URLSearchParams(await props.searchParams);
    searchParams.set("status", "approved");

    let sites: ListSitesResponse["sites"] = [];
    let pagination: ListSitesResponse["pagination"] = {
        total: 0,
        page: 1,
        pageSize: 20
    };
    try {
        const res = await internal.get<AxiosResponse<ListSitesResponse>>(
            `/org/${params.orgId}/sites?${searchParams.toString()}`,
            await authCookieHeader()
        );
        const responseData = res.data.data;
        sites = responseData.sites;
        pagination = responseData.pagination;
    } catch (e) {}

    const t = await getTranslations();

    function formatSize(mb: number, type: string): string {
        if (type === "local") {
            return "-"; // because we are not able to track the data use in a local site right now
        }
        if (mb >= 1024 * 1024) {
            return t("terabytes", { count: (mb / (1024 * 1024)).toFixed(2) });
        } else if (mb >= 1024) {
            return t("gigabytes", { count: (mb / 1024).toFixed(2) });
        } else {
            return t("megabytes", { count: mb.toFixed(2) });
        }
    }

    const siteRows: SiteRow[] = sites.map((site) => {
        return {
            name: site.name,
            id: site.siteId,
            labels: site.labels,
            nice: site.niceId.toString(),
            address: site.address?.split("/")[0],
            mbIn: formatSize(site.megabytesIn || 0, site.type),
            mbOut: formatSize(site.megabytesOut || 0, site.type),
            resourceCount: Number(site.resourceCount ?? 0),
            orgId: params.orgId,
            type: site.type as any,
            online: site.online,
            newtVersion: site.newtVersion || undefined,
            newtUpdateAvailable: site.newtUpdateAvailable || false,
            exitNodeName: site.exitNodeName || undefined,
            exitNodeEndpoint: site.exitNodeEndpoint || undefined,
            remoteExitNodeId: (site as any).remoteExitNodeId || undefined,
            dnsStatus: site.dnsStatus || null
        };
    });

    return (
        <>
            <SettingsSectionTitle
                title={t("siteManageSites")}
                description={t("siteDescription")}
            />

            <SitesBanner />

            <SitesTable
                sites={siteRows}
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
