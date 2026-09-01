"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AxiosResponse } from "axios";
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
import { Button } from "@app/components/ui/button";
import CopyTextBox from "@app/components/CopyTextBox";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import type { GetVirtualApiKeyResponse } from "@server/routers/virtualApiKey/types";
import { formatVirtualApiKeyCredential } from "@app/lib/virtualApiKeyFormat";

type ViewVirtualApiKeySecretProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
    virtualApiKeyId: string | null;
    name?: string | null;
};

export default function ViewVirtualApiKeySecret({
    open,
    setOpen,
    virtualApiKeyId,
    name
}: ViewVirtualApiKeySecretProps) {
    const t = useTranslations();
    const api = createApiClient(useEnvContext());
    const [loading, setLoading] = useState(false);
    const [credential, setCredential] = useState<string | null>(null);

    useEffect(() => {
        if (!open || !virtualApiKeyId) {
            return;
        }

        let cancelled = false;
        setLoading(true);
        setCredential(null);

        api.get<AxiosResponse<GetVirtualApiKeyResponse>>(
            `/virtual-api-key/${virtualApiKeyId}`
        )
            .then((res) => {
                if (cancelled) {
                    return;
                }
                const key = res.data.data.virtualApiKey;
                if (key.secret) {
                    setCredential(
                        formatVirtualApiKeyCredential(
                            key.virtualApiKeyId,
                            key.secret
                        )
                    );
                } else {
                    toast({
                        variant: "destructive",
                        title: t("virtualApiKeysErrorFetchSecret"),
                        description: t(
                            "virtualApiKeysErrorFetchSecretDescription"
                        )
                    });
                }
            })
            .catch((e) => {
                if (cancelled) {
                    return;
                }
                toast({
                    variant: "destructive",
                    title: t("virtualApiKeysErrorFetchSecret"),
                    description: formatAxiosError(
                        e,
                        t("virtualApiKeysErrorFetchSecretDescription")
                    )
                });
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [open, virtualApiKeyId]);

    return (
        <Credenza
            open={open}
            onOpenChange={(val) => {
                setOpen(val);
                if (!val) {
                    setCredential(null);
                    setLoading(false);
                }
            }}
        >
            <CredenzaContent>
                <CredenzaHeader>
                    <CredenzaTitle>
                        {t("virtualApiKeysViewSecretTitle")}
                    </CredenzaTitle>
                    <CredenzaDescription>
                        {name ? name : t("virtualApiKeysViewSecretDescription")}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                    <div className="space-y-4 px-1">
                        {loading && (
                            <p className="text-sm text-muted-foreground">
                                {t("loading")}
                            </p>
                        )}
                        {!loading && credential && (
                            <CopyTextBox text={credential} wrapText={false} />
                        )}
                    </div>
                </CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button variant="outline">{t("close")}</Button>
                    </CredenzaClose>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
