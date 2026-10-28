"use client";

import { useQuery } from "@tanstack/react-query";
import { domainQueries } from "@app/lib/queries";
import { GetDomainResponse } from "@server/routers/domain/getDomain";
import { GetDNSRecordsResponse } from "@server/routers/domain";
import DomainInfoCard from "@app/components/DomainInfoCard";
import DNSRecordsTable from "@app/components/DNSRecordTable";
import DomainCertForm from "@app/components/DomainCertForm";
import { build } from "@server/build";
import { useEnvContext } from "@app/hooks/useEnvContext";

interface DomainSetupClientProps {
    initialDomain: GetDomainResponse;
    initialDnsRecords: GetDNSRecordsResponse;
    orgId: string;
    domainId: string;
}

export default function DomainSetupClient({
    initialDomain,
    initialDnsRecords,
    orgId,
    domainId
}: DomainSetupClientProps) {
    const { env } = useEnvContext();

    const { data: domain } = useQuery({
        ...domainQueries.getDomain({ orgId, domainId }),
        initialData: initialDomain
    });

    const { data: dnsRecords } = useQuery({
        ...domainQueries.getDNSRecords({ orgId, domainId }),
        initialData: initialDnsRecords
    });

    return (
        <>
            {build !== "oss" && env.flags.usePangolinDns ? (
                <DomainInfoCard
                    failed={domain.failed}
                    verified={domain.verified}
                    type={domain.type}
                    errorMessage={domain.errorMessage}
                />
            ) : null}

            <DNSRecordsTable
                records={dnsRecords.map((r) => ({
                    ...r,
                    id: String(r.id)
                }))}
                type={domain.type}
            />

            {domain.type === "wildcard" && !domain.configManaged && (
                <DomainCertForm
                    orgId={orgId}
                    domainId={domain.domainId}
                    domain={domain}
                />
            )}
        </>
    );
}
