"use client";

import { SettingsContainer } from "@app/components/Settings";
import SettingsHeaderTitle from "@app/components/SettingsSectionTitle";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { Button } from "@app/components/ui/button";
import { Label } from "@app/components/ui/label";
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
import CopyTextBox from "@app/components/CopyTextBox";
import { useTranslations } from "next-intl";
import { ResponseT } from "@server/types/Response";
import OAuthClientForm, { type OAuthClientFormData } from "../OAuthClientForm";

export default function CreateOAuthClientPage() {
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const params = useParams();
    const router = useRouter();
    const t = useTranslations();

    const orgId = params.orgId as string;

    const [creating, setCreating] = useState(false);
    const [createdSecret, setCreatedSecret] = useState<{
        clientId: string;
        clientSecret: string;
    } | null>(null);

    async function handleCreate(data: OAuthClientFormData) {
        setCreating(true);
        try {
            const res = await api.post<ResponseT<{ clientId: string; clientSecret: string }>>(
                `/org/${orgId}/oauth-clients`,
                {
                    clientName: data.clientName,
                    redirectUris: data.redirectUris,
                    clientUri: data.clientUri || undefined,
                    logoUri: data.logoUri || undefined,
                    backchannelLogoutUri: data.backchannelLogoutUri || undefined,
                    postLogoutRedirectUris: data.postLogoutRedirectUris.length > 0
                        ? data.postLogoutRedirectUris
                        : undefined,
                    scopes: data.scopes,
                    pkceRequired: data.pkceRequired,
                    enabled: data.enabled
                }
            );

            setCreatedSecret(res.data.data);
            toast({
                title: t("oauthClientCreateSuccessTitle"),
                description: t("oauthClientCreateSuccessDescription")
            });
        } catch (error) {
            toast({
                variant: "destructive",
                title: t("oauthClientCreateErrorTitle"),
                description: formatAxiosError(error)
            });
        } finally {
            setCreating(false);
        }
    }

    return (
        <>
            <div className="flex justify-between">
                <SettingsHeaderTitle
                    title={t("oauthClientsCreateTitle")}
                    description={t("oauthClientsCreateDescription")}
                />
                <Button
                    variant="outline"
                    onClick={() =>
                        router.push(`/${orgId}/settings/oauth-clients`)
                    }
                >
                    {t("oauthClientBackButton")}
                </Button>
            </div>

            <Credenza
                open={Boolean(createdSecret)}
                onOpenChange={(open) => {
                    if (!open) {
                        setCreatedSecret(null);
                        router.push(`/${orgId}/settings/oauth-clients`);
                    }
                }}
            >
                <CredenzaContent>
                    <CredenzaHeader>
                        <CredenzaTitle>
                            {t("oauthClientSecretDialogTitle")}
                        </CredenzaTitle>
                        <CredenzaDescription>
                            {t("oauthClientSecretDialogDescription")}
                        </CredenzaDescription>
                    </CredenzaHeader>
                    <CredenzaBody>
                        {createdSecret && (
                            <div className="space-y-3">
                                <div className="space-y-1">
                                    <Label>{t("oauthClientIdHeader")}</Label>
                                    <CopyTextBox text={createdSecret.clientId} wrapText />
                                </div>
                                <div className="space-y-1">
                                    <Label>{t("oauthClientSecretLabel")}</Label>
                                    <CopyTextBox text={createdSecret.clientSecret} wrapText />
                                </div>
                            </div>
                        )}
                    </CredenzaBody>
                    <CredenzaFooter>
                        <CredenzaClose asChild>
                            <Button variant="outline">
                                {t("close")}
                            </Button>
                        </CredenzaClose>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>

            <SettingsContainer>
                <OAuthClientForm
                    onSubmit={handleCreate}
                    submitting={creating}
                    submitLabel={t("oauthClientCreateButton")}
                    avatarFallback={t("oauthClientsCreateTitle")}
                    footerExtra={
                        <Button
                            variant="outline"
                            onClick={() =>
                                router.push(`/${orgId}/settings/oauth-clients`)
                            }
                        >
                            {t("cancel")}
                        </Button>
                    }
                />
            </SettingsContainer>
        </>
    );
}
