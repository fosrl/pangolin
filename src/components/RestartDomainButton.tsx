"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@app/components/ui/button";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { useTranslations } from "next-intl";

interface RestartDomainButtonProps {
    orgId: string;
    domainId: string;
}

export default function RestartDomainButton({ orgId, domainId }: RestartDomainButtonProps) {
    const router = useRouter();
    const api = createApiClient(useEnvContext());
    const [isRestarting, setIsRestarting] = useState(false);
    const t = useTranslations();

    const restartDomain = async () => {
        setIsRestarting(true);
        try {
            await api.post(`/org/${orgId}/domain/${domainId}/restart`);
            toast({
                title: t("success"),
                description: t("domainRestartedDescription", {
                    fallback: "Domain verification restarted successfully"
                })
            });
            // Wait a bit before refreshing to allow the restart to take effect
            await new Promise((resolve) => setTimeout(resolve, 200));
            router.refresh();
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        } finally {
            setIsRestarting(false);
        }
    };

    return (
        <Button
            variant="outline"
            onClick={restartDomain}
            disabled={isRestarting}
        >
            {isRestarting ? (
                <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    {t("restarting", { fallback: "Restarting..." })}
                </>
            ) : (
                <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {t("restart", { fallback: "Restart" })}
                </>
            )}
        </Button>
    );
}
