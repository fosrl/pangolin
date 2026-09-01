"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AxiosResponse } from "axios";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import type { GetMyVirtualApiKeyResponse } from "@server/routers/virtualApiKey/types";
import { formatVirtualApiKeyCredential } from "@app/lib/virtualApiKeyFormat";

export function useMyVirtualApiKeySecret(
    orgId: string,
    virtualApiKeyId: string
) {
    const t = useTranslations();
    const env = useEnvContext();
    const [credential, setCredential] = useState<string | null>(null);
    const [revealed, setRevealed] = useState(false);
    const [loading, setLoading] = useState(false);
    const credentialRef = useRef<string | null>(null);
    const inFlightRef = useRef<Promise<string | null> | null>(null);

    const getCredential = useCallback(async (): Promise<string | null> => {
        if (credentialRef.current) {
            return credentialRef.current;
        }

        if (inFlightRef.current) {
            return inFlightRef.current;
        }

        const api = createApiClient(env);
        const request = api
            .get<AxiosResponse<GetMyVirtualApiKeyResponse>>(
                `/org/${orgId}/my-virtual-api-keys/${virtualApiKeyId}`
            )
            .then((res) => {
                const secret = res.data.data.virtualApiKey.secret;
                if (!secret) {
                    toast({
                        variant: "destructive",
                        title: t("virtualApiKeysErrorFetchSecret"),
                        description: t(
                            "virtualApiKeysErrorFetchSecretDescription"
                        )
                    });
                    return null;
                }

                const formatted = formatVirtualApiKeyCredential(
                    virtualApiKeyId,
                    secret
                );
                credentialRef.current = formatted;
                setCredential(formatted);
                return formatted;
            })
            .catch((e) => {
                toast({
                    variant: "destructive",
                    title: t("virtualApiKeysErrorFetchSecret"),
                    description: formatAxiosError(
                        e,
                        t("virtualApiKeysErrorFetchSecretDescription")
                    )
                });
                return null;
            })
            .finally(() => {
                setLoading(false);
                inFlightRef.current = null;
            });

        setLoading(true);
        inFlightRef.current = request;
        return request;
    }, [env, orgId, t, virtualApiKeyId]);

    const getCopyText = useCallback(async () => {
        const value = await getCredential();
        if (!value) {
            throw new Error("Failed to fetch virtual API key secret");
        }
        return value;
    }, [getCredential]);

    const revealSecret = useCallback(async () => {
        if (revealed) {
            return;
        }

        const value = await getCredential();
        if (value) {
            setRevealed(true);
        }
    }, [getCredential, revealed]);

    return {
        credential,
        revealed,
        loading,
        getCredential,
        getCopyText,
        revealSecret
    };
}
