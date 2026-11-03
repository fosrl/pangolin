"use client";

import { useQuery } from "@tanstack/react-query";
import { domainQueries } from "@app/lib/queries";
import { GetDomainResponse } from "@server/routers/domain/getDomain";
import { GetDNSRecordsResponse } from "@server/routers/domain";
import DomainInfoCard from "@app/components/DomainInfoCard";
import DNSRecordsTable from "@app/components/DNSRecordTable";
import DomainCertForm from "@app/components/DomainCertForm";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import { Badge } from "@app/components/ui/badge";
import { Button } from "@app/components/ui/button";
import { build } from "@server/build";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import Link from "next/link";

type DomainSetupClientProps = {
    initialDomain: GetDomainResponse;
    initialDnsRecords: GetDNSRecordsResponse;
    orgId: string;
    domainId: string;
};

export default function DomainSetupClient({
    initialDomain,
    initialDnsRecords,
    orgId,
    domainId
}: DomainSetupClientProps) {
    const { env } = useEnvContext();
    const t = useTranslations();

    const { data: domain } = useQuery({
        ...domainQueries.getDomain({ orgId, domainId }),
        initialData: initialDomain
    });

    const { data: dnsRecords } = useQuery({
        ...domainQueries.getDNSRecords({ orgId, domainId }),
        initialData: initialDnsRecords
    });

    return (
        <SettingsContainer>
            {build !== "oss" && env.flags.usePangolinDns ? (
                <DomainInfoCard
                    failed={domain.failed}
                    verified={domain.verified}
                    type={domain.type}
                    errorMessage={domain.errorMessage}
                />
            ) : null}

            <SettingsSection>
                <SettingsSectionHeader>
                    <div className="flex justify-between items-start gap-4">
                        <div className="space-y-0.5 min-w-0">
                            <SettingsSectionTitle>
                                {t("dnsRecord")}
                                <Badge variant="secondary">
                                    {t("required")}
                                </Badge>
                            </SettingsSectionTitle>
                            <SettingsSectionDescription>
                                {t("domainSetupRecordsDescription")}
                            </SettingsSectionDescription>
                        </div>
                        <Link
                            href="https://docs.pangolin.net/manage/domains"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hidden sm:block shrink-0"
                        >
                            <Button variant="outline" size="sm">
                                <ExternalLink className="h-4 w-4 mr-1" />
                                {t("howToAddRecords")}
                            </Button>
                        </Link>
                    </div>
                </SettingsSectionHeader>
                <SettingsSectionBody>
                    <DNSRecordsTable
                        records={dnsRecords.map((r) => ({
                            ...r,
                            id: String(r.id)
                        }))}
                        type={domain.type}
                    />
                </SettingsSectionBody>
            </SettingsSection>

            {domain.type === "wildcard" && !domain.configManaged && (
                <DomainCertForm
                    orgId={orgId}
                    domainId={domain.domainId}
                    domain={domain}
                />
            )}
        </SettingsContainer>
    );
}
