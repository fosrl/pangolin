import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { ListSitesResponse } from "@server/routers/site";
import { AxiosResponse } from "axios";
import SitesTable, { SiteRow } from "../../../../components/SitesTable";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import SitesSplashCard from "../../../../components/SitesSplashCard";
import { getTranslations } from "next-intl/server";

type SitesPageProps = {
    params: Promise<{ orgId: string }>;
};

export const dynamic = "force-dynamic";

export default async function SitesPage(props: SitesPageProps) {
    const params = await props.params;
    let sites: ListSitesResponse["sites"] = [];
    try {
        const res = await internal.get<AxiosResponse<ListSitesResponse>>(
            `/org/${params.orgId}/sites`,
            await authCookieHeader()
        );
        sites = res.data.data.sites;
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
            nice: site.niceId.toString(),
            address: site.address?.split("/")[0],
            mbIn: formatSize(site.megabytesIn || 0, site.type),
            mbOut: formatSize(site.megabytesOut || 0, site.type),
            orgId: params.orgId,
            type: site.type as any,
            online: site.online,
            newtVersion: site.newtVersion || undefined,
            newtUpdateAvailable: site.newtUpdateAvailable || false,
            exitNodeName: site.exitNodeName || undefined,
            exitNodeEndpoint: site.exitNodeEndpoint || undefined,
            remoteExitNodeId: (site as any).remoteExitNodeId || undefined
        };
    });

    return (
        <>
            {/* <SitesSplashCard /> */}

            <SettingsSectionTitle
                title={t("siteManageSites")}
                description={t("siteDescription")}
            />

            <SitesTable sites={siteRows} orgId={params.orgId} />
        </>
    );
}
