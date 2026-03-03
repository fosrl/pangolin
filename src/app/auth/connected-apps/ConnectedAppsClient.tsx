"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@app/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from "@app/components/ui/card";
import { Badge } from "@app/components/ui/badge";
import {
    Credenza,
    CredenzaBody,
    CredenzaClose,
    CredenzaContent,
    CredenzaDescription,
    CredenzaFooter,
    CredenzaHeader,
    CredenzaTitle
} from "@app/components/Credenza";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { ResponseT } from "@server/types/Response";
import { ArrowLeft, Loader2, Unplug } from "lucide-react";
import moment from "moment";
import ClientAvatar from "@app/components/ClientAvatar";

type Consent = {
    consentId: string;
    clientId: string;
    scope: string;
    createdAt: number;
    clientName: string;
    clientUri: string | null;
    logoUri: string | null;
};

export default function ConnectedAppsClient() {
    const t = useTranslations();
    const router = useRouter();
    const { env } = useEnvContext();
    const api = createApiClient({ env });

    const [consents, setConsents] = useState<Consent[]>([]);
    const [loading, setLoading] = useState(true);
    const [disconnecting, setDisconnecting] = useState<string | null>(null);
    const [confirmConsent, setConfirmConsent] = useState<Consent | null>(null);

    const fetchConsents = async () => {
        setLoading(true);
        try {
            const res = await api.get<ResponseT<Consent[]>>(
                "/user/oauth/consents"
            );
            if (res.data.success && res.data.data) {
                setConsents(res.data.data);
            }
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: t("connectedAppsLoadError"),
                description: formatAxiosError(
                    error,
                    t("connectedAppsLoadError")
                )
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchConsents();
    }, []);

    const handleDisconnect = async (consent: Consent) => {
        setDisconnecting(consent.consentId);
        try {
            await api.delete(`/user/oauth/consent/${consent.consentId}`);
            setConsents((prev) =>
                prev.filter((c) => c.consentId !== consent.consentId)
            );
            toast({
                title: t("connectedAppDisconnected"),
                description: t("connectedAppDisconnectedDescription")
            });
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: t("connectedAppDisconnectError"),
                description: formatAxiosError(
                    error,
                    t("connectedAppDisconnectError")
                )
            });
        } finally {
            setDisconnecting(null);
            setConfirmConsent(null);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin" />
            </div>
        );
    }

    return (
        <>
            <Credenza
                open={!!confirmConsent}
                onOpenChange={(val) => {
                    if (!val) setConfirmConsent(null);
                }}
            >
                <CredenzaContent>
                    <CredenzaHeader>
                        <CredenzaTitle>
                            {t("connectedAppDisconnectConfirmTitle")}
                        </CredenzaTitle>
                        <CredenzaDescription>
                            {t("connectedAppDisconnectConfirmDescription", {
                                appName: confirmConsent?.clientName ?? ""
                            })}
                        </CredenzaDescription>
                    </CredenzaHeader>
                    <CredenzaBody>
                        <p className="text-sm text-muted-foreground">
                            {t("connectedAppDisconnectConfirmWarning")}
                        </p>
                    </CredenzaBody>
                    <CredenzaFooter>
                        <CredenzaClose asChild>
                            <Button variant="outline">
                                {t("cancel")}
                            </Button>
                        </CredenzaClose>
                        <Button
                            variant="destructive"
                            loading={!!disconnecting}
                            disabled={!!disconnecting}
                            onClick={() => {
                                if (confirmConsent) {
                                    handleDisconnect(confirmConsent);
                                }
                            }}
                        >
                            {t("disconnect")}
                        </Button>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>

            {consents.length === 0 ? (
                <div className="text-center py-12">
                    <Unplug className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">
                        {t("noConnectedApps")}
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {consents.map((consent) => (
                        <Card key={consent.consentId}>
                            <CardHeader className="pb-3">
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-3">
                                        <ClientAvatar
                                            name={consent.clientName}
                                            logoUri={consent.logoUri}
                                            size="lg"
                                        />
                                        <div>
                                            <CardTitle className="text-base">
                                                {consent.clientName}
                                            </CardTitle>
                                            {consent.clientUri && (
                                                <CardDescription className="text-xs">
                                                    {consent.clientUri}
                                                </CardDescription>
                                            )}
                                        </div>
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                            setConfirmConsent(consent)
                                        }
                                        disabled={!!disconnecting}
                                    >
                                        {t("disconnect")}
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent className="pt-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs text-muted-foreground">
                                        {t("connectedAppScopes")}:
                                    </span>
                                    {consent.scope
                                        .split(" ")
                                        .map((scope) => (
                                            <Badge
                                                key={scope}
                                                variant="secondary"
                                                className="text-xs"
                                            >
                                                {scope}
                                            </Badge>
                                        ))}
                                </div>
                                <p className="text-xs text-muted-foreground mt-2">
                                    {t("connectedAppAuthorizedOn", {
                                        date: moment(
                                            consent.createdAt
                                        ).format("lll")
                                    })}
                                </p>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            <div className="pt-2">
                <Button variant="outline" onClick={() => router.back()}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    {t("back")}
                </Button>
            </div>
        </>
    );
}
