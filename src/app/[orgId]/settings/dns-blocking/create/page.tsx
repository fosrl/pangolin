import DnsBlockListForm from "@app/components/DnsBlockListForm";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { getTranslations } from "next-intl/server";

type Props = {
    params: Promise<{ orgId: string }>;
};

export default async function CreateDnsBlockListPage({ params }: Props) {
    const { orgId } = await params;
    const t = await getTranslations();

    return (
        <>
            <SettingsSectionTitle
                title={t("dnsBlockListCreateTitle")}
                description={t("dnsBlockListCreateDescription")}
            />
            <DnsBlockListForm orgId={orgId} />
        </>
    );
}
