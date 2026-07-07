import type { InternalResourceRow } from "@app/components/PrivateResourcesTable";
import PrivateResourcesTable from "@app/components/PrivateResourcesTable";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import PrivateResourcesBanner from "@app/components/PrivateResourcesBanner";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { getCachedOrg } from "@app/lib/api/getCachedOrg";
import OrgProvider from "@app/providers/OrgProvider";
import type { ListResourcesResponse } from "@server/routers/resource";
import { GetSiteResponse } from "@server/routers/site/getSite";
import type { ListAllSiteResourcesByOrgResponse } from "@server/routers/siteResource";
import type ResponseT from "@server/types/Response";
import type { AxiosResponse } from "axios";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
    title: "Private Resources"
};

export interface ClientResourcesPageProps {
    params: Promise<{ orgId: string }>;
    searchParams: Promise<Record<string, string>>;
}

function parsePositiveInt(s: string | undefined): number | undefined {
    if (!s) return undefined;
    const n = Number(s);
    if (!Number.isInteger(n) || n <= 0) return undefined;
    return n;
}

export default async function ClientResourcesPage(
    props: ClientResourcesPageProps
) {
    const params = await props.params;
    const t = await getTranslations();
    const searchParams = new URLSearchParams(await props.searchParams);

    let siteResources: ListAllSiteResourcesByOrgResponse["siteResources"] = [];
    let pagination: ListResourcesResponse["pagination"] = {
        total: 0,
        page: 1,
        pageSize: 20
    };
    try {
        const res = await internal.get<
            AxiosResponse<ListAllSiteResourcesByOrgResponse>
        >(
            `/org/${params.orgId}/site-resources?${searchParams.toString()}`,
            await authCookieHeader()
        );
        const responseData = res.data.data;
        siteResources = responseData.siteResources;
        pagination = responseData.pagination;
    } catch (e) {}

    const siteIdParam = parsePositiveInt(
        searchParams.get("siteId") ?? undefined
    );

    let initialFilterSite: {
        siteId: number;
        name: string;
        type: string;
    } | null = null;
    if (siteIdParam) {
        try {
            const siteRes = await internal.get(
                `/site/${siteIdParam}`,
                await authCookieHeader()
            );
            const s = (siteRes.data as ResponseT<GetSiteResponse>).data;
            if (s && s.orgId === params.orgId) {
                initialFilterSite = {
                    siteId: s.siteId,
                    name: s.name,
                    type: s.type
                };
            }
        } catch {
            // leave null
        }
    }

    let org = null;
    try {
        const res = await getCachedOrg(params.orgId);
        org = res.data.data;
    } catch {
        redirect(`/${params.orgId}/settings/resources`);
    }

    if (!org) {
        redirect(`/${params.orgId}/settings/resources`);
    }

    const internalResourceRows: InternalResourceRow[] = siteResources.map(
        (siteResource) => {
            return {
                id: siteResource.siteResourceId,
                name: siteResource.name,
                orgId: params.orgId,
                sites: siteResource.siteIds.map((siteId, idx) => ({
                    siteId,
                    siteName: siteResource.siteNames[idx],
                    siteNiceId: siteResource.siteNiceIds[idx],
                    online: siteResource.siteOnlines[idx]
                })),
                mode: siteResource.mode,
                scheme: siteResource.scheme,
                ssl: siteResource.ssl,
                siteNames: siteResource.siteNames,
                siteAddresses: siteResource.siteAddresses || null,
                // protocol: siteResource.protocol,
                // proxyPort: siteResource.proxyPort,
                siteIds: siteResource.siteIds,
                destination: siteResource.destination,
                destinationPort: siteResource.destinationPort ?? null,
                alias: siteResource.alias || null,
                aliasAddress: siteResource.aliasAddress || null,
                siteNiceIds: siteResource.siteNiceIds,
                niceId: siteResource.niceId,
                tcpPortRangeString: siteResource.tcpPortRangeString || null,
                udpPortRangeString: siteResource.udpPortRangeString || null,
                disableIcmp: siteResource.disableIcmp || false,
                authDaemonMode: siteResource.authDaemonMode ?? null,
                authDaemonPort: siteResource.authDaemonPort ?? null,
                pamMode: siteResource.pamMode ?? null,
                subdomain: siteResource.subdomain ?? null,
                domainId: siteResource.domainId ?? null,
                fullDomain: siteResource.fullDomain ?? null,
                labels: siteResource.labels ?? []
            };
        }
    );
    return (
        <>
            <SettingsSectionTitle
                title={t("clientResourceTitle")}
                description={t("clientResourceDescription")}
            />

            <PrivateResourcesBanner orgId={params.orgId} />

            <OrgProvider org={org}>
                <PrivateResourcesTable
                    internalResources={internalResourceRows}
                    orgId={params.orgId}
                    rowCount={pagination.total}
                    pagination={{
                        pageIndex: pagination.page - 1,
                        pageSize: pagination.pageSize
                    }}
                    initialFilterSite={initialFilterSite}
                />
            </OrgProvider>
        </>
    );
}
