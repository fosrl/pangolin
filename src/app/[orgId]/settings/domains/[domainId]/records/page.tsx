import DomainRecordsClient from "@app/components/DomainRecordsClient";
import { GetDomainResponse } from "@server/routers/domain/getDomain";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { pullEnv } from "@app/lib/pullEnv";
import { supportsCustomDnsRecords } from "@app/lib/customDnsRecords";
import { redirect } from "next/navigation";

interface DomainRecordsPageProps {
    params: Promise<{ domainId: string; orgId: string }>;
}

export default async function DomainRecordsPage({
    params
}: DomainRecordsPageProps) {
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

    if (!domain) {
        return null;
    }

    if (!supportsCustomDnsRecords(pullEnv(), domain.type)) {
        redirect(`/${orgId}/settings/domains/${domainId}/setup`);
    }

    return (
        <DomainRecordsClient
            initialDomain={domain}
            orgId={orgId}
            domainId={domainId}
        />
    );
}
