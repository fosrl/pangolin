"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { domainQueries } from "@app/lib/queries";
import { GetDomainResponse } from "@server/routers/domain/getDomain";
import RestartDomainButton from "@app/components/RestartDomainButton";
import RefreshButton from "@app/components/RefreshButton";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { Badge } from "@app/components/ui/badge";

interface DomainHeaderProps {
    initialDomain: GetDomainResponse;
    orgId: string;
}

export default function DomainHeader({
    initialDomain,
    orgId
}: DomainHeaderProps) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const queryClient = useQueryClient();
    const domainId = initialDomain.domainId;

    const { data: domain } = useQuery({
        ...domainQueries.getDomain({ orgId, domainId }),
        initialData: initialDomain
    });

    // Every domain query shares this key prefix, so this refreshes whichever
    // tab is showing
    const refetchAll = () => {
        queryClient.invalidateQueries({
            queryKey: ["ORG", orgId, "DOMAIN", domainId]
        });
    };

    return (
        <div className="flex justify-between">
            <SettingsSectionTitle
                title={
                    <span className="flex items-center gap-2">
                        {domain.baseDomain}
                        {domain.configManaged && (
                            <Badge
                                variant="secondary"
                                className="flex items-center gap-1 text-sm font-normal"
                            >
                                <Lock className="h-3 w-3" />
                                {t("configManaged", {
                                    fallback: "Config Managed"
                                })}
                            </Badge>
                        )}
                    </span>
                }
                description={t("domainSettingDescription")}
            />
            {env.flags.usePangolinDns && domain.failed ? (
                <RestartDomainButton
                    orgId={orgId}
                    domainId={domain.domainId}
                    onSuccess={refetchAll}
                />
            ) : (
                <RefreshButton onRefresh={refetchAll} />
            )}
        </div>
    );
}
