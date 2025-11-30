import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import DomainInfoCard from "@app/components/DomainInfoCard";
import RestartDomainButton from "@app/components/RestartDomainButton";
import { GetDomainResponse } from "@server/routers/domain/getDomain";
import { pullEnv } from "@app/lib/pullEnv";
import { getTranslations } from "next-intl/server";
import RefreshButton from "@app/components/RefreshButton";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { GetDNSRecordsResponse } from "@server/routers/domain";
import DNSRecordsTable from "@app/components/DNSRecordTable";
import DomainCertForm from "@app/components/DomainCertForm";

interface DomainSettingsPageProps {
    params: Promise<{ domainId: string; orgId: string }>;
}

export default async function DomainSettingsPage({
    params
}: DomainSettingsPageProps) {
    const { domainId, orgId } = await params;
    const t = await getTranslations();
    const env = pullEnv();

    let domain: GetDomainResponse | null = null;
    try {
        const res = await internal.get(
            `/org/${orgId}/domain/${domainId}`,
            await authCookieHeader()
        );
        domain = res.data.data;
    } catch {
        return null;
    }

    let dnsRecords;
    try {
        const response = await internal.get(
            `/org/${orgId}/domain/${domainId}/dns-records`,
            await authCookieHeader()
        );
        dnsRecords = response.data.data;
    } catch (error) {
        return null;
    }

    if (!domain) {
        return null;
    }

    return (
        <>
            <div className="flex justify-between">
                <SettingsSectionTitle
                    title={domain.baseDomain}
                    description={t("domainSettingDescription")}
                />
                {env.flags.usePangolinDns && domain.failed ? (
                    <RestartDomainButton
                        orgId={orgId}
                        domainId={domain.domainId}
                    />
                ) : (
                    <RefreshButton />
                )}
            </div>
            <div className="space-y-6">
                <DomainInfoCard
                    failed={domain.failed}
                    verified={domain.verified}
                    type={domain.type}
                />

                <DNSRecordsTable records={dnsRecords} type={domain.type} />

                {domain.type == "wildcard" && !domain.configManaged && (
                    <DomainCertForm
                        orgId={orgId}
                        domainId={domain.domainId}
                        domain={domain}
                    />
                )}
            </div>
        </>
    );
}
