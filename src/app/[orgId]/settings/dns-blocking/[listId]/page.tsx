import DnsBlockListForm from "@app/components/DnsBlockListForm";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import type { GetDnsBlockListResponse } from "@server/routers/dnsBlocking/types";
import type { AxiosResponse } from "axios";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = {
    params: Promise<{ orgId: string; listId: string }>;
};

export default async function DnsBlockListPage({ params }: Props) {
    const { orgId, listId } = await params;
    const t = await getTranslations();

    const res = await internal
        .get<AxiosResponse<GetDnsBlockListResponse>>(
            `/org/${orgId}/dns-block-list/${listId}`,
            await authCookieHeader()
        )
        .catch(() => null);

    const list = res?.data.data;
    if (!list) {
        redirect(`/${orgId}/settings/dns-blocking`);
    }

    return (
        <>
            <SettingsSectionTitle
                title={list.name}
                description={t("dnsBlockListEditDescription")}
            />
            <DnsBlockListForm orgId={orgId} list={list} />
        </>
    );
}
