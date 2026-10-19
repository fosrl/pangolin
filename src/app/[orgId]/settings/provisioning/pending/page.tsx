import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { ListSitesResponse } from "@server/routers/site";
import { AxiosResponse } from "axios";
import { SiteRow } from "@app/components/SitesTable";
import PendingSitesTable from "@app/components/PendingSitesTable";
import { getTranslations } from "next-intl/server";
import DismissableBanner from "@app/components/DismissableBanner";
import Link from "next/link";
import { Button } from "@app/components/ui/button";
import { ArrowRight, Plug } from "lucide-react";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { TierFeature, tierMatrix } from "@server/lib/billing/tierMatrix";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Pending Sites"
};

type PendingSitesPageProps = {
    params: Promise<{ orgId: string }>;
    searchParams: Promise<Record<string, string>>;
};

export const dynamic = "force-dynamic";

export default async function PendingSitesPage(props: PendingSitesPageProps) {
    const params = await props.params;

    const incomingSearchParams = new URLSearchParams(await props.searchParams);
    incomingSearchParams.set("status", "pending");

    let sites: ListSitesResponse["sites"] = [];
    let pagination: ListSitesResponse["pagination"] = {
        total: 0,
        page: 1,
        pageSize: 20
    };

    try {
        const res = await internal.get<AxiosResponse<ListSitesResponse>>(
            `/org/${params.orgId}/sites?${incomingSearchParams.toString()}`,
            await authCookieHeader()
        );
        const responseData = res.data.data;
        sites = responseData.sites;
        pagination = responseData.pagination;
    } catch (e) {}

    const t = await getTranslations();

    function formatSize(mb: number, type: string): string {
        if (type === "local") {
            return "-";
        }
        if (mb >= 1024 * 1024) {
            return t("terabytes", { count: (mb / (1024 * 1024)).toFixed(2) });
        } else if (mb >= 1024) {
            return t("gigabytes", { count: (mb / 1024).toFixed(2) });
        } else {
            return t("megabytes", { count: mb.toFixed(2) });
        }
    }

    const siteRows: SiteRow[] = sites.map((site) => ({
        name: site.name,
        id: site.siteId,
        nice: site.niceId.toString(),
        address: site.address?.split("/")[0],
        mbIn: formatSize(site.megabytesIn || 0, site.type),
        mbOut: formatSize(site.megabytesOut || 0, site.type),
        resourceCount: Number(site.resourceCount ?? 0),
        orgId: params.orgId,
        type: site.type as any,
        online: site.online,
        newtVersion: site.newtVersion || undefined,
        agent: site.agent || undefined,
        agentVersion: site.agentVersion || undefined,
        newtUpdateAvailable: site.newtUpdateAvailable || false,
        exitNodeName: site.exitNodeName || undefined,
        exitNodeEndpoint: site.exitNodeEndpoint || undefined,
        remoteExitNodeId: (site as any).remoteExitNodeId || undefined
    }));

    return (
        <>
            <DismissableBanner
                storageKey="sites-banner-dismissed"
                version={1}
                title={t("pendingSitesBannerTitle")}
                titleIcon={<Plug className="w-5 h-5 text-primary" />}
                description={t("pendingSitesBannerDescription")}
            >
                <Link
                    href="https://docs.pangolin.net/manage/sites/install-site"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <Button
                        variant="outline"
                        size="sm"
                        className="gap-2 hover:bg-primary/10 hover:border-primary/50 transition-colors"
                    >
                        {t("pendingSitesBannerButtonText")}
                        <ArrowRight className="w-4 h-4" />
                    </Button>
                </Link>
            </DismissableBanner>
            <PaidFeaturesAlert
                tiers={tierMatrix[TierFeature.SiteProvisioningKeys]}
            />

            <PendingSitesTable
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
