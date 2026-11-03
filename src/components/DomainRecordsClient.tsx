"use client";

import { useQuery } from "@tanstack/react-query";
import { domainQueries } from "@app/lib/queries";
import { GetDomainResponse } from "@server/routers/domain/getDomain";
import CustomDnsRecordsTable from "@app/components/CustomDnsRecordsTable";
import { Alert, AlertDescription, AlertTitle } from "@app/components/ui/alert";
import { useTranslations } from "next-intl";
import { InfoIcon } from "lucide-react";

interface DomainRecordsClientProps {
    initialDomain: GetDomainResponse;
    orgId: string;
    domainId: string;
}

export default function DomainRecordsClient({
    initialDomain,
    orgId,
    domainId
}: DomainRecordsClientProps) {
    const t = useTranslations();

    const { data: domain } = useQuery({
        ...domainQueries.getDomain({ orgId, domainId }),
        initialData: initialDomain
    });

    return (
        <>
            <Alert variant="info">
                <InfoIcon className="h-4 w-4" />
                <AlertTitle>{t("domainRecordsInfoTitle")}</AlertTitle>
                <AlertDescription>
                    {t("domainRecordsInfoDescription", {
                        domain: domain.baseDomain
                    })}
                </AlertDescription>
            </Alert>

            <CustomDnsRecordsTable
                orgId={orgId}
                domainId={domain.domainId}
                baseDomain={domain.baseDomain}
                verified={domain.verified}
            />
        </>
    );
}
