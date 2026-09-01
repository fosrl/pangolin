import type { SiteResourceData } from "@app/lib/privateResourceForm";
import type { ListAllSiteResourcesByOrgResponse } from "@server/routers/siteResource";
import type { AxiosResponse } from "axios";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";

export async function fetchSiteResourceByNiceId(
    orgId: string,
    niceId: string
): Promise<SiteResourceData | null> {
    const res = await internal.get<
        AxiosResponse<ListAllSiteResourcesByOrgResponse>
    >(
        `/org/${orgId}/site-resources?query=${encodeURIComponent(niceId)}&pageSize=50`,
        await authCookieHeader()
    );

    const match = res.data.data.siteResources.find((r) => r.niceId === niceId);

    if (!match) {
        return null;
    }

    return {
        id: match.siteResourceId,
        name: match.name,
        orgId,
        sites: match.siteIds.map((siteId, idx) => ({
            siteId,
            siteName: match.siteNames[idx],
            siteNiceId: match.siteNiceIds[idx],
            online: match.siteOnlines[idx]
        })),
        mode: match.mode,
        scheme: match.scheme,
        ssl: match.ssl,
        siteNames: match.siteNames,
        siteAddresses: match.siteAddresses || null,
        siteIds: match.siteIds,
        destination: match.destination,
        destinationPort: match.destinationPort ?? null,
        alias: match.alias || null,
        aliasAddress: match.aliasAddress || null,
        siteNiceIds: match.siteNiceIds,
        niceId: match.niceId,
        tcpPortRangeString: match.tcpPortRangeString ?? null,
        udpPortRangeString: match.udpPortRangeString ?? null,
        disableIcmp: match.disableIcmp || false,
        authDaemonMode: match.authDaemonMode ?? null,
        authDaemonPort: match.authDaemonPort ?? null,
        pamMode: match.pamMode ?? null,
        subdomain: match.subdomain ?? null,
        domainId: match.domainId ?? null,
        fullDomain: match.fullDomain ?? null,
        labels: match.labels ?? [],
        enabled: match.enabled
    };
}
