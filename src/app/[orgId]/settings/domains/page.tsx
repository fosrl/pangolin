import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { AxiosResponse } from "axios";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import DomainsTable, { DomainRow } from "../../../../components/DomainsTable";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import { GetOrgResponse } from "@server/routers/org";
import { redirect } from "next/navigation";
import OrgProvider from "@app/providers/OrgProvider";
import { ListDomainsResponse } from "@server/routers/domain";
import { toUnicode } from "punycode";
import { getCachedOrg } from "@app/lib/api/getCachedOrg";

type Props = {
    params: Promise<{ orgId: string }>;
};

export default async function DomainsPage(props: Props) {
    const params = await props.params;

    let domains: DomainRow[] = [];
    try {
        const res = await internal.get<AxiosResponse<ListDomainsResponse>>(
            `/org/${params.orgId}/domains`,
            await authCookieHeader()
        );

        const rawDomains = res.data.data.domains as DomainRow[];

        domains = rawDomains.map((domain) => ({
            ...domain,
            baseDomain: toUnicode(domain.baseDomain)
        }));
    } catch (e) {
        console.error(e);
    }

    let org = null;
    try {
        const res = await getCachedOrg(params.orgId);
        org = res.data.data;
    } catch {
        redirect(`/${params.orgId}`);
    }

    const t = await getTranslations();

    return (
        <>
            <OrgProvider org={org}>
                <SettingsSectionTitle
                    title={t("domains")}
                    description={t("domainsDescription")}
                />
                <DomainsTable domains={domains} orgId={org.org.orgId} />
            </OrgProvider>
        </>
    );
}
