"use client";

import { useQuery } from "@tanstack/react-query";
import { domainQueries } from "@app/lib/queries";
import { GetDomainResponse } from "@server/routers/domain/getDomain";
import CustomDnsRecordsTable from "@app/components/CustomDnsRecordsTable";
import DismissableBanner from "@app/components/DismissableBanner";
import { useTranslations } from "next-intl";
import { InfoIcon } from "lucide-react";

type DomainRecordsClientProps = {
    initialDomain: GetDomainResponse;
    orgId: string;
    domainId: string;
};

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
            <DismissableBanner
                storageKey="domain-records-banner-dismissed"
                version={1}
                title={t("domainRecordsInfoTitle")}
                titleIcon={<InfoIcon className="w-5 h-5 text-primary" />}
                description={t("domainRecordsInfoDescription", {
                    domain: domain.baseDomain
                })}
            />

            <CustomDnsRecordsTable
                orgId={orgId}
                domainId={domain.domainId}
                baseDomain={domain.baseDomain}
                verified={domain.verified}
            />
        </>
    );
}
