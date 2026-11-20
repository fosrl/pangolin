"use client";

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from "@app/components/ui/card";
import { Alert, AlertDescription } from "@app/components/ui/alert";
import { Button } from "@app/components/ui/button";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import type {
    GenerateIdpTestLinkUrlResponse,
    GetIdpTestLinkInfoResponse
} from "@server/routers/idp";
import { AxiosResponse } from "axios";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

type IdpTestLinkLandingProps = {
    idpId: string;
    token: string;
};

/**
 * Page behind a shared test link: the person signs in with the IdP so the
 * admins who sent the link can see their claims. They aren't signed in to
 * Pangolin and nothing about their account changes.
 */
export default function IdpTestLinkLanding({
    idpId,
    token
}: IdpTestLinkLandingProps) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const api = createApiClient({ env });

    const [info, setInfo] = useState<GetIdpTestLinkInfoResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [starting, setStarting] = useState(false);

    useEffect(() => {
        api.get<AxiosResponse<GetIdpTestLinkInfoResponse>>(
            `/auth/idp/${idpId}/oidc/test-link/${encodeURIComponent(token)}`
        )
            .then((res) => setInfo(res.data.data))
            .catch(() => setError(t("idpTestLinkNotFound")));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [idpId, token]);

    async function start() {
        setStarting(true);
        try {
            const res = await api.post<
                AxiosResponse<GenerateIdpTestLinkUrlResponse>
            >(
                `/auth/idp/${idpId}/oidc/test-link/${encodeURIComponent(token)}/generate-url`,
                {}
            );
            window.location.href = res.data.data.redirectUrl;
        } catch (e) {
            setError(formatAxiosError(e));
            setStarting(false);
        }
    }

    return (
        <div className="flex items-center justify-center">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle>{t("idpTestLinkPageTitle")}</CardTitle>
                    {info && (
                        <CardDescription>
                            {info.requestedBy
                                ? t("idpTestLinkPageDescription", {
                                      requestedBy: info.requestedBy,
                                      idpName: info.idpName
                                  })
                                : t("idpTestLinkPageDescriptionNoRequester", {
                                      idpName: info.idpName
                                  })}
                        </CardDescription>
                    )}
                </CardHeader>
                <CardContent className="flex flex-col space-y-4">
                    {!info && !error && (
                        <div className="flex items-center space-x-2">
                            <Loader2 className="h-5 w-5 animate-spin" />
                        </div>
                    )}
                    {error && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-5 w-5" />
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}
                    {info?.status === "completed" && (
                        <div className="flex items-center space-x-2 text-green-600">
                            <CheckCircle2 className="h-5 w-5" />
                            <span>{t("idpTestLinkPageCompleted")}</span>
                        </div>
                    )}
                    {info?.status === "expired" && !error && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-5 w-5" />
                            <AlertDescription>
                                {t("idpTestLinkPageExpired")}
                            </AlertDescription>
                        </Alert>
                    )}
                    {info?.status === "pending" && (
                        <>
                            <p className="text-sm text-muted-foreground">
                                {t("idpTestLinkPageDisclosure")}
                            </p>
                            <Button
                                onClick={start}
                                loading={starting}
                                disabled={starting}
                            >
                                {t("idpTestLinkPageSignIn", {
                                    idpName: info.idpName
                                })}
                            </Button>
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
