"use client";

import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionDescription,
    SettingsSectionFooter,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import SettingsHeaderTitle from "@app/components/SettingsSectionTitle";
import { useEffect, useState } from "react";
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
import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import { useTranslations } from "next-intl";
import type { PublicOAuthClient } from "@server/lib/oauth/clientAuth";
import { ResponseT } from "@server/types/Response";
import { OFFLINE_ACCESS_SCOPE } from "@server/lib/oauth/scopes";
import OAuthClientForm, {
    type OAuthClientFormData
} from "@app/components/OAuthClientForm";

function parseScopes(scopeString: string): Set<string> {
    return new Set(
        scopeString
            .split(" ")
            .map((scope) => scope.trim())
            .filter((scope) => scope.length > 0)
    );
}

export default function EditOAuthClientPage() {
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const params = useParams();
    const router = useRouter();
    const t = useTranslations();

    const orgId = params.orgId as string;
    const clientId = params.clientId as string;

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [client, setClient] = useState<PublicOAuthClient | null>(null);
    const [rotatedSecret, setRotatedSecret] = useState<{
        clientId: string;
        clientSecret: string;
    } | null>(null);
    const [isRotateModalOpen, setIsRotateModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

    useEffect(() => {
        const load = async () => {
            if (!orgId || !clientId) {
                return;
            }

            setLoading(true);

            try {
                const res = await api.get<
                    ResponseT<{ client: PublicOAuthClient }>
                >(`/org/${orgId}/oauth-clients/${clientId}`);
                setClient(res.data.data!.client);
            } catch (error) {
                toast({
                    variant: "destructive",
                    title: t("oauthClientLoadErrorTitle"),
                    description: formatAxiosError(error)
                });
            } finally {
                setLoading(false);
            }
        };

        load();
    }, [orgId, clientId]);

    async function handleSave(data: OAuthClientFormData) {
        setSaving(true);
        try {
            await api.patch(`/org/${orgId}/oauth-clients/${clientId}`, {
                clientName: data.clientName,
                redirectUris: data.redirectUris,
                clientUri: data.clientUri || null,
                logoUri: data.logoUri || null,
                backchannelLogoutUri: data.backchannelLogoutUri || null,
                postLogoutRedirectUris:
                    data.postLogoutRedirectUris.length > 0
                        ? data.postLogoutRedirectUris
                        : null,
                scopes: data.scopes,
                pkceRequired: data.pkceRequired,
                clientAuthenticationMethod: data.clientAuthenticationMethod,
                enabled: data.enabled,
                logoutTerminatesPangolinSession:
                    data.logoutTerminatesPangolinSession
            });

            toast({
                title: t("oauthClientUpdateSuccessTitle"),
                description: t("oauthClientUpdateSuccessDescription")
            });
        } catch (error) {
            toast({
                variant: "destructive",
                title: t("oauthClientUpdateErrorTitle"),
                description: formatAxiosError(error)
            });
        } finally {
            setSaving(false);
        }
    }

    async function rotateSecret() {
        try {
            const res = await api.post<
                ResponseT<{ clientId: string; clientSecret: string }>
            >(`/org/${orgId}/oauth-clients/${clientId}/rotate-secret`);

            setRotatedSecret(res.data.data);
            toast({
                title: t("oauthClientRotateSuccessTitle"),
                description: t("oauthClientRotateSuccessDescription")
            });
        } catch (error) {
            toast({
                variant: "destructive",
                title: t("oauthClientRotateErrorTitle"),
                description: formatAxiosError(error)
            });
        }
    }

    async function deleteClient() {
        try {
            await api.delete(`/org/${orgId}/oauth-clients/${clientId}`);
            toast({
                title: t("oauthClientDeleteSuccessTitle"),
                description: t("oauthClientDeleteSuccessDescription")
            });
            router.push(`/${orgId}/settings/oauth-clients`);
        } catch (error) {
            toast({
                variant: "destructive",
                title: t("oauthClientDeleteErrorTitle"),
                description: formatAxiosError(error)
            });
        }
    }

    if (loading || !client) {
        return (
            <>
                <SettingsHeaderTitle
                    title={t("oauthClientEditTitle")}
                    description={t("oauthClientEditDescription")}
                />
                <p className="text-sm text-muted-foreground">
                    {t("oauthClientLoading")}
                </p>
            </>
        );
    }

    const clientScopes = parseScopes(client.scopes);
    const postLogoutUris = client.postLogoutRedirectUris ?? [];

    return (
        <>
            <div className="flex justify-between">
                <SettingsHeaderTitle
                    title={t("oauthClientEditTitle")}
                    description={t("oauthClientEditDescription")}
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
                open={Boolean(rotatedSecret)}
                onOpenChange={(open) => {
                    if (!open) {
                        setRotatedSecret(null);
                    }
                }}
            >
                <CredenzaContent>
                    <CredenzaHeader>
                        <CredenzaTitle>
                            {t("oauthClientNewSecretDialogTitle")}
                        </CredenzaTitle>
                        <CredenzaDescription>
                            {t("oauthClientNewSecretDialogDescription")}
                        </CredenzaDescription>
                    </CredenzaHeader>
                    <CredenzaBody>
                        {rotatedSecret && (
                            <div className="space-y-3">
                                <div className="space-y-1">
                                    <Label>{t("oauthClientIdHeader")}</Label>
                                    <CopyTextBox
                                        text={rotatedSecret.clientId}
                                        wrapText
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label>{t("oauthClientSecretLabel")}</Label>
                                    <CopyTextBox
                                        text={rotatedSecret.clientSecret}
                                        wrapText
                                    />
                                </div>
                            </div>
                        )}
                    </CredenzaBody>
                    <CredenzaFooter>
                        <CredenzaClose asChild>
                            <Button variant="outline">{t("close")}</Button>
                        </CredenzaClose>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>

            <Credenza
                open={isRotateModalOpen}
                onOpenChange={setIsRotateModalOpen}
            >
                <CredenzaContent>
                    <CredenzaHeader>
                        <CredenzaTitle>
                            {t("oauthClientRotateConfirmTitle")}
                        </CredenzaTitle>
                        <CredenzaDescription>
                            {t("oauthClientRotateConfirmDescription")}
                        </CredenzaDescription>
                    </CredenzaHeader>
                    <CredenzaFooter>
                        <CredenzaClose asChild>
                            <Button variant="outline">{t("cancel")}</Button>
                        </CredenzaClose>
                        <Button
                            variant="destructive"
                            onClick={() => {
                                setIsRotateModalOpen(false);
                                rotateSecret();
                            }}
                        >
                            {t("oauthClientRotateButton")}
                        </Button>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>

            <ConfirmDeleteDialog
                open={isDeleteModalOpen}
                setOpen={setIsDeleteModalOpen}
                dialog={
                    <div className="space-y-2">
                        <p>{t("oauthClientDeleteConfirm")}</p>
                    </div>
                }
                buttonText={t("oauthClientDeleteButton")}
                onConfirm={deleteClient}
                string={client.clientName}
                title={t("oauthClientDeleteButton")}
            />

            <SettingsContainer>
                <OAuthClientForm
                    initialValues={{
                        clientName: client.clientName,
                        clientUri: client.clientUri || "",
                        logoUri: client.logoUri || "",
                        backchannelLogoutUri: client.backchannelLogoutUri || "",
                        postLogoutRedirectUris:
                            postLogoutUris.length > 0 ? postLogoutUris : [""],
                        redirectUris:
                            client.redirectUris.length > 0
                                ? client.redirectUris
                                : [""],
                        scopeProfile: clientScopes.has("profile"),
                        scopeEmail: clientScopes.has("email"),
                        scopeGroups: clientScopes.has("groups"),
                        scopeOfflineAccess:
                            clientScopes.has(OFFLINE_ACCESS_SCOPE),
                        pkceRequired: client.pkceRequired,
                        clientAuthenticationMethod:
                            client.clientAuthenticationMethod,
                        enabled: client.enabled,
                        logoutTerminatesPangolinSession:
                            client.logoutTerminatesPangolinSession
                    }}
                    clientId={clientId}
                    onSubmit={handleSave}
                    submitting={saving}
                    submitLabel={t("saveChanges")}
                    footerExtra={
                        <Button
                            variant="outline"
                            onClick={() => setIsRotateModalOpen(true)}
                        >
                            {t("oauthClientRotateButton")}
                        </Button>
                    }
                />

                <SettingsSection>
                    <SettingsSectionHeader>
                        <SettingsSectionTitle>
                            {t("dangerSection")}
                        </SettingsSectionTitle>
                        <SettingsSectionDescription>
                            {t("oauthClientDeleteConfirm")}
                        </SettingsSectionDescription>
                    </SettingsSectionHeader>
                    <SettingsSectionFooter>
                        <Button
                            variant="destructive"
                            onClick={() => setIsDeleteModalOpen(true)}
                        >
                            {t("oauthClientDeleteButton")}
                        </Button>
                    </SettingsSectionFooter>
                </SettingsSection>
            </SettingsContainer>
        </>
    );
}
