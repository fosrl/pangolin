import RedirectsTable from "@app/components/RedirectsTable";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { build } from "@server/build";
import type { GetBatchedCertificateResponse } from "@server/routers/certificates/types";
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

    const redirectRows = redirects.map((redirect) => ({
        redirectId: redirect.redirectId,
        niceId: redirect.niceId,
        name: redirect.name,
        subdomain: redirect.subdomain,
        destinationHost: redirect.destinationHost,
        pathMatchType: redirect.pathMatchType,
        matchPath: redirect.matchPath,
        rewritePath: redirect.rewritePath,
        rewritePathType: redirect.rewritePathType,
        priority: redirect.priority,
        permanent: redirect.permanent,
        enabled: redirect.enabled,
        resourceId: redirect.resourceId,
        resourceName: redirect.resourceName,
        resourceNiceId: redirect.resourceNiceId,
        resourceFullDomain: redirect.resourceFullDomain,
        resourceDomainId: redirect.resourceDomainId,
        domainId: redirect.domainId,
        baseDomain: redirect.baseDomain
    }));

    // Prefetched in one batched call so the table doesn't fire a separate
    // certificate request per visible row once it mounts on the client.
    const certDomains = Array.from(
        new Set(
            redirectRows
                .map((r) => {
                    const domainHost = r.baseDomain
                        ? [r.subdomain, r.baseDomain].filter(Boolean).join(".")
                        : null;
                    return r.resourceFullDomain ?? domainHost;
                })
                .filter((host): host is string => Boolean(host))
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
                `/org/${orgId}/batched-certificates?${certSearchParams.toString()}`,
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
                title={t("redirectsTitle")}
                description={t("redirectsDescription")}
            />

            <RedirectsTable
                orgId={orgId}
                redirects={redirectRows}
                rowCount={pagination.total}
                pagination={{
                    pageIndex: pagination.page - 1,
                    pageSize: pagination.pageSize
                }}
                initialCertificates={initialCertificates}
            />
        </>
    );
}
