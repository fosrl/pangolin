import type { InternalResourceRow } from "@app/components/ClientResourcesTable";
import ClientResourcesTable from "@app/components/ClientResourcesTable";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { getCachedOrg } from "@app/lib/api/getCachedOrg";
import OrgProvider from "@app/providers/OrgProvider";
import type { ListResourcesResponse } from "@server/routers/resource";
import type { ListAllSiteResourcesByOrgResponse } from "@server/routers/siteResource";
import type { AxiosResponse } from "axios";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

export interface ClientResourcesPageProps {
    params: Promise<{ orgId: string }>;
    searchParams: Promise<{ view?: string }>;
}

export default async function ClientResourcesPage(
    props: ClientResourcesPageProps
) {
    const params = await props.params;
    const t = await getTranslations();

    let resources: ListResourcesResponse["resources"] = [];
    try {
        const res = await internal.get<AxiosResponse<ListResourcesResponse>>(
            `/org/${params.orgId}/resources`,
            await authCookieHeader()
        );
        resources = res.data.data.resources;
    } catch (e) {}

    let siteResources: ListAllSiteResourcesByOrgResponse["siteResources"] = [];
    try {
        const res = await internal.get<
            AxiosResponse<ListAllSiteResourcesByOrgResponse>
        >(`/org/${params.orgId}/site-resources`, await authCookieHeader());
        siteResources = res.data.data.siteResources;
    } catch (e) {}

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
                siteName: siteResource.siteName,
                siteAddress: siteResource.siteAddress || null,
                mode: siteResource.mode || ("port" as any),
                // protocol: siteResource.protocol,
                // proxyPort: siteResource.proxyPort,
                siteId: siteResource.siteId,
                destination: siteResource.destination,
                // destinationPort: siteResource.destinationPort,
                alias: siteResource.alias || null,
                siteNiceId: siteResource.siteNiceId,
                niceId: siteResource.niceId,
                tcpPortRangeString: siteResource.tcpPortRangeString || null,
                udpPortRangeString: siteResource.udpPortRangeString || null
            };
        }
    );
    return (
        <>
            <SettingsSectionTitle
                title={t("clientResourceTitle")}
                description={t("clientResourceDescription")}
            />

            <OrgProvider org={org}>
                <ClientResourcesTable
                    internalResources={internalResourceRows}
                    orgId={params.orgId}
                    defaultSort={{
                        id: "name",
                        desc: false
                    }}
                />
            </OrgProvider>
        </>
    );
}
