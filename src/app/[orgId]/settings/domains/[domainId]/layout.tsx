import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { GetDomainResponse } from "@server/routers/domain/getDomain";
import { AxiosResponse } from "axios";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { HorizontalTabs } from "@app/components/HorizontalTabs";
import DomainHeader from "@app/components/DomainHeader";
import { pullEnv } from "@app/lib/pullEnv";
import { supportsCustomDnsRecords } from "@app/lib/customDnsRecords";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Domain"
};

export const dynamic = "force-dynamic";

interface DomainLayoutProps {
    children: React.ReactNode;
    params: Promise<{ domainId: string; orgId: string }>;
}

export default async function DomainLayout(props: DomainLayoutProps) {
    const { domainId, orgId } = await props.params;
    const t = await getTranslations();
    const env = pullEnv();

    let domain: GetDomainResponse | null = null;
    try {
        const res = await internal.get<AxiosResponse<GetDomainResponse>>(
            `/org/${orgId}/domain/${domainId}`,
            await authCookieHeader()
        );
        domain = res.data.data;
    } catch {
        redirect(`/${orgId}/settings/domains`);
    }

    if (!domain) {
        redirect(`/${orgId}/settings/domains`);
    }

    const navItems = [
        {
            title: t("domainTabSetup"),
            href: `/{orgId}/settings/domains/{domainId}/setup`
        }
    ];

    if (supportsCustomDnsRecords(env, domain.type)) {
        navItems.push({
            title: t("domainTabRecords"),
            href: `/{orgId}/settings/domains/{domainId}/records`
        });
    }

    return (
        <>
            <DomainHeader initialDomain={domain} orgId={orgId} />
            <HorizontalTabs items={navItems}>{props.children}</HorizontalTabs>
        </>
    );
}
