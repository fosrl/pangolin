import RedirectsTable, {
    type RedirectFilterDomain
} from "@app/components/RedirectsTable";
import type { SelectedResource } from "@app/components/resource-selector";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { GetDomainResponse } from "@server/routers/domain/getDomain";
import type { ListRedirectsResponse } from "@server/routers/redirect";
import { GetResourceResponse } from "@server/routers/resource/getResource";
import type ResponseT from "@server/types/Response";
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

function parsePositiveInt(value: string | null): number | undefined {
    if (!value) return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
    return parsed;
}

export default async function RedirectIndexPage(props: RedirectIndexPageProps) {
    const { orgId } = await props.params;
    const searchParams = new URLSearchParams(await props.searchParams);
    const t = await getTranslations();
    const header = await authCookieHeader();

    let redirects: ListRedirectsResponse["redirects"] = [];
    let pagination: ListRedirectsResponse["pagination"] = {
        total: 0,
        page: 1,
        pageSize: 20
    };

    try {
        const res = await internal.get<AxiosResponse<ListRedirectsResponse>>(
            `/org/${orgId}/redirects?${searchParams.toString()}`,
            header
        );
        const responseData = res.data.data;
        redirects = responseData.redirects;
        pagination = responseData.pagination;
    } catch {
        // empty list on error
    }

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

    const domainIdParam = searchParams.get("domainId");
    let initialFilterDomain: RedirectFilterDomain | null = null;
    if (domainIdParam) {
        try {
            const domainRes = await internal.get(
                `/org/${orgId}/domain/${domainIdParam}`,
                header
            );
            const domain = (domainRes.data as ResponseT<GetDomainResponse>)
                .data;
            if (domain) {
                initialFilterDomain = {
                    domainId: domain.domainId,
                    baseDomain: domain.baseDomain
                };
            }
        } catch {
            // leave null so the table falls back to the id
        }
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
                initialFilterResource={initialFilterResource}
                initialFilterDomain={initialFilterDomain}
            />
        </>
    );
}
