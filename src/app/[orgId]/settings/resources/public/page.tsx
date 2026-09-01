import type { ResourceRow } from "@app/components/PublicResourcesTable";
import PublicResourcesTable from "@app/components/PublicResourcesTable";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import PublicResourcesBanner from "@app/components/PublicResourcesBanner";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import OrgProvider from "@app/providers/OrgProvider";
import { build } from "@server/build";
import type { GetBatchedCertificateResponse } from "@server/routers/certificates/types";
import type { GetOrgResponse } from "@server/routers/org";
import type { ListResourcesResponse } from "@server/routers/resource";
import { GetSiteResponse } from "@server/routers/site/getSite";
import type ResponseT from "@server/types/Response";
import type { AxiosResponse } from "axios";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { toUnicode } from "punycode";
import { cache } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Public Resources"
};

export interface ProxyResourcesPageProps {
    params: Promise<{ orgId: string }>;
    searchParams: Promise<Record<string, string>>;
}

function parsePositiveInt(s: string | undefined): number | undefined {
    if (!s) return undefined;
    const n = Number(s);
    if (!Number.isInteger(n) || n <= 0) return undefined;
    return n;
}

export default async function ProxyResourcesPage(
    props: ProxyResourcesPageProps
) {
    const params = await props.params;
    const t = await getTranslations();
    const searchParams = new URLSearchParams(await props.searchParams);
    searchParams.set("status", "approved");

    let resources: ListResourcesResponse["resources"] = [];
    let pagination: ListResourcesResponse["pagination"] = {
        total: 0,
        page: 1,
        pageSize: 20
    };
    try {
        const res = await internal.get<AxiosResponse<ListResourcesResponse>>(
            `/org/${params.orgId}/resources?${searchParams.toString()}`,
            await authCookieHeader()
        );
        const responseData = res.data.data;
        resources = responseData.resources;
        pagination = responseData.pagination;
    } catch (e) {}

    const siteIdParam = parsePositiveInt(
        searchParams.get("siteId") ?? undefined
    );



    let org = null;
    try {
        const getOrg = cache(async () =>
            internal.get<AxiosResponse<GetOrgResponse>>(
                `/org/${params.orgId}`,
                await authCookieHeader()
            )
        );
        const res = await getOrg();
        org = res.data.data;
    } catch {
        redirect(`/${params.orgId}/settings/resources`);
    }

    if (!org) {
        redirect(`/${params.orgId}/settings/resources`);
    }

    const resourceRows: ResourceRow[] = resources.map((resource) => {
        return {
            id: resource.resourceId,
            name: resource.name,
            orgId: params.orgId,
            nice: resource.niceId,
            domain: `${resource.ssl ? "https://" : "http://"}${toUnicode(resource.fullDomain || "")}`,
            proxyPort: resource.proxyPort,
            labels: resource.labels,
            authState: !["http", "ssh", "rdp", "vnc"].includes(
                resource.mode || ""
            )
                ? "none"
                : resource.sso ||
                    resource.pincodeId !== null ||
                    resource.passwordId !== null ||
                    resource.whitelist ||
                    resource.headerAuthId
                  ? "protected"
                  : "not_protected",
            enabled: resource.enabled,
            domainId: resource.domainId || undefined,
            fullDomain: resource.fullDomain ?? null,
            ssl: resource.ssl,
            wildcard: resource.wildcard,
            mode: resource.mode,
            targets: resource.targets?.map((target) => ({
                targetId: target.targetId,
                ip: target.ip,
                port: target.port,
                enabled: target.enabled,
                healthStatus: target.healthStatus,
                siteName: target.siteName
            })),
            sites: resource.sites ?? [],
            health: (resource.health as ResourceRow["health"]) ?? undefined
        };
    });
    // Prefetched in one batched call so the table doesn't fire a separate
    // certificate request per visible row once it mounts on the client.
    const certDomains = Array.from(
        new Set(
            resourceRows
                .filter((r) => r.ssl && r.fullDomain)
                .map((r) => r.fullDomain as string)
        )
    );

    let initialCertificates: GetBatchedCertificateResponse | undefined;
    if (build !== "oss" && certDomains.length > 0) {
        try {
            const certSearchParams = new URLSearchParams(
                certDomains.map((domain) => ["domains", domain])
            );
            const certRes = await internal.get<
                AxiosResponse<GetBatchedCertificateResponse>
            >(
                `/org/${params.orgId}/batched-certificates?${certSearchParams.toString()}`,
                await authCookieHeader()
            );
            initialCertificates = certRes.data.data;
        } catch {
            // leave undefined so each row falls back to fetching its own
        }
    }

    return (
        <>
            <SettingsSectionTitle
                title={t("proxyResourceTitle")}
                description={t("proxyResourceDescription")}
            />

            <PublicResourcesBanner />

            <OrgProvider org={org}>
                <PublicResourcesTable
                    resources={resourceRows}
                    orgId={params.orgId}
                    rowCount={pagination.total}
                    pagination={{
                        pageIndex: pagination.page - 1,
                        pageSize: pagination.pageSize
                    }}
                    initialCertificates={initialCertificates}
                />
            </OrgProvider>
        </>
    );
}
