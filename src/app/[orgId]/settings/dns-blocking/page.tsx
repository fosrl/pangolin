import DnsBlockingBanner from "@app/components/DnsBlockingBanner";
import DnsBlockListsTable from "@app/components/DnsBlockListsTable";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import type { ListDnsBlockListsResponse } from "@server/routers/dnsBlocking/types";
import type { AxiosResponse } from "axios";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = {
    title: "DNS Blocking"
};

export const dynamic = "force-dynamic";

type Props = {
    params: Promise<{ orgId: string }>;
};

export default async function DnsBlockingPage({ params }: Props) {
    const { orgId } = await params;
    const t = await getTranslations();

    let lists: ListDnsBlockListsResponse["lists"] = [];
    try {
        const res = await internal.get<
            AxiosResponse<ListDnsBlockListsResponse>
        >(`/org/${orgId}/dns-block-lists`, await authCookieHeader());
        lists = res.data.data.lists;
    } catch {
        // empty list on error, for example when the feature is not licensed
    }

    return (
        <>
            <SettingsSectionTitle
                title={t("dnsBlockingTitle")}
                description={t("dnsBlockingDescription")}
            />

            <DnsBlockingBanner orgId={orgId} />

            <DnsBlockListsTable orgId={orgId} lists={lists} />
        </>
    );
}
