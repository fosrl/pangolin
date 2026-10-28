import DomainSetupClient from "@app/components/DomainSetupClient";
import { GetDomainResponse } from "@server/routers/domain/getDomain";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { GetDNSRecordsResponse } from "@server/routers/domain";

interface DomainSetupPageProps {
    params: Promise<{ domainId: string; orgId: string }>;
}

export default async function DomainSetupPage({
    params
}: DomainSetupPageProps) {
    const { domainId, orgId } = await params;

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

    let dnsRecords: GetDNSRecordsResponse | null = null;
    try {
        const response = await internal.get(
            `/org/${orgId}/domain/${domainId}/dns-records`,
            await authCookieHeader()
        );
        dnsRecords = response.data.data;
    } catch {
        return null;
    }

    if (!domain || !dnsRecords) {
        return null;
    }

    return (
        <DomainSetupClient
            initialDomain={domain}
            initialDnsRecords={dnsRecords}
            orgId={orgId}
            domainId={domainId}
        />
    );
}
