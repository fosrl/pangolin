"use client";

import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import SettingsHeaderTitle from "@app/components/SettingsSectionTitle";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { Button } from "@app/components/ui/button";
import { Input } from "@app/components/ui/input";
import { Label } from "@app/components/ui/label";
import { Checkbox } from "@app/components/ui/checkbox";
import { Switch } from "@app/components/ui/switch";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from "@app/components/ui/dialog";
import CopyTextBox from "@app/components/CopyTextBox";
import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import { useTranslations } from "next-intl";
import { parseRedirectUris } from "@app/lib/parseRedirectUris";

type OAuthClient = {
    clientId: string;
    clientName: string;
    clientUri: string | null;
    logoUri: string | null;
    redirectUris: string;
    scopes: string;
    pkceRequired: boolean;
    enabled: boolean;
    orgId: string;
    createdAt: number;
    updatedAt: number;
    lastChars: string;
};

type GetClientResponse = {
    data: {
        client: OAuthClient;
    };
    success: boolean;
    error: boolean;
    message: string;
    status: number;
};

type RotateSecretResponse = {
    data: {
        clientId: string;
        clientSecret: string;
    };
    success: boolean;
    error: boolean;
    message: string;
    status: number;
};

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

    const orgId = useMemo(() => {
        const rawOrgId = params.orgId;
        if (Array.isArray(rawOrgId)) {
            return rawOrgId[0];
        }
        return rawOrgId || "";
    }, [params.orgId]);

    const clientId = useMemo(() => {
        const rawClientId = params.clientId;
        if (Array.isArray(rawClientId)) {
            return rawClientId[0];
        }
        return rawClientId || "";
    }, [params.clientId]);

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [clientName, setClientName] = useState("");
    const [clientUri, setClientUri] = useState("");
    const [logoUri, setLogoUri] = useState("");
    const [redirectUris, setRedirectUris] = useState<string[]>([""]);
    const [scopeProfile, setScopeProfile] = useState(true);
    const [scopeEmail, setScopeEmail] = useState(true);
    const [scopeGroups, setScopeGroups] = useState(false);
    const [pkceRequired, setPkceRequired] = useState(true);
    const [enabled, setEnabled] = useState(true);
    const [rotatedSecret, setRotatedSecret] = useState<{
        clientId: string;
        clientSecret: string;
    } | null>(null);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

    useEffect(() => {
        const load = async () => {
            if (!orgId || !clientId) {
                return;
            }

            setLoading(true);

            try {
                const res = await api.get<GetClientResponse>(
                    `/org/${orgId}/oauth-clients/${clientId}`
                );
                const client = res.data.data.client;
                const clientScopes = parseScopes(client.scopes);

                setClientName(client.clientName);
                setClientUri(client.clientUri || "");
                setLogoUri(client.logoUri || "");
                setRedirectUris(
                    parseRedirectUris(client.redirectUris).length > 0
                        ? parseRedirectUris(client.redirectUris)
                        : [""]
                );
                setScopeProfile(clientScopes.has("profile"));
                setScopeEmail(clientScopes.has("email"));
                setScopeGroups(clientScopes.has("groups"));
                setPkceRequired(client.pkceRequired);
                setEnabled(client.enabled);
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

    function updateRedirectUri(index: number, value: string) {
        setRedirectUris((prev) =>
            prev.map((item, i) => (i === index ? value : item))
        );
    }

    function removeRedirectUri(index: number) {
        setRedirectUris((prev) => prev.filter((_, i) => i !== index));
    }

    async function saveClient() {
        const cleanedRedirectUris = redirectUris
            .map((item) => item.trim())
            .filter((item) => item.length > 0);

        if (!clientName.trim()) {
            toast({
                variant: "destructive",
                title: t("oauthClientNameRequired")
            });
            return;
        }

        if (cleanedRedirectUris.length === 0) {
            toast({
                variant: "destructive",
                title: t("oauthClientRedirectUrisRequired")
            });
            return;
        }

        setSaving(true);

        try {
            const scopes = ["openid"];
            if (scopeProfile) {
                scopes.push("profile");
            }
            if (scopeEmail) {
                scopes.push("email");
            }
            if (scopeGroups) {
                scopes.push("groups");
            }

            await api.patch(`/org/${orgId}/oauth-clients/${clientId}`, {
                clientName: clientName.trim(),
                redirectUris: cleanedRedirectUris,
                clientUri: clientUri.trim() || undefined,
                logoUri: logoUri.trim() || undefined,
                scopes,
                pkceRequired,
                enabled
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
            const res = await api.post<RotateSecretResponse>(
                `/org/${orgId}/oauth-clients/${clientId}/rotate-secret`
            );

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

    if (loading) {
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

            <Dialog
                open={Boolean(rotatedSecret)}
                onOpenChange={(open) => {
                    if (!open) {
                        setRotatedSecret(null);
                    }
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {t("oauthClientNewSecretDialogTitle")}
                        </DialogTitle>
                        <DialogDescription>
                            {t("oauthClientNewSecretDialogDescription")}
                        </DialogDescription>
                    </DialogHeader>
                    {rotatedSecret && (
                        <div className="space-y-3">
                            <div className="space-y-1">
                                <Label>{t("oauthClientIdHeader")}</Label>
                                <CopyTextBox text={rotatedSecret.clientId} wrapText />
                            </div>
                            <div className="space-y-1">
                                <Label>{t("oauthClientSecretLabel")}</Label>
                                <CopyTextBox text={rotatedSecret.clientSecret} wrapText />
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

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
                string={clientName}
                title={t("oauthClientDeleteButton")}
            />

            <SettingsContainer>
                <SettingsSection>
                    <SettingsSectionHeader>
                        <SettingsSectionTitle>
                            {t("oauthClientNameLabel")}
                        </SettingsSectionTitle>
                    </SettingsSectionHeader>
                    <SettingsSectionBody>
                        <SettingsSectionForm>
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label>
                                        {t("oauthClientIdHeader")}
                                    </Label>
                                    <CopyTextBox text={clientId} />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="client-name">
                                        {t("oauthClientNameLabel")}
                                    </Label>
                                    <Input
                                        id="client-name"
                                        value={clientName}
                                        onChange={(event) =>
                                            setClientName(event.target.value)
                                        }
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="client-uri">
                                        {t("oauthClientHomepageLabel")}
                                    </Label>
                                    <Input
                                        id="client-uri"
                                        value={clientUri}
                                        onChange={(event) =>
                                            setClientUri(event.target.value)
                                        }
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="logo-uri">
                                        {t("oauthClientLogoLabel")}
                                    </Label>
                                    <Input
                                        id="logo-uri"
                                        value={logoUri}
                                        onChange={(event) =>
                                            setLogoUri(event.target.value)
                                        }
                                    />
                                </div>
                            </div>
                        </SettingsSectionForm>
                    </SettingsSectionBody>
                </SettingsSection>

                <SettingsSection>
                    <SettingsSectionHeader>
                        <SettingsSectionTitle>
                            {t("oauthClientRedirectUrisLabel")}
                        </SettingsSectionTitle>
                    </SettingsSectionHeader>
                    <SettingsSectionBody>
                        <SettingsSectionForm>
                            <div className="space-y-3">
                                {redirectUris.map((redirectUri, index) => (
                                    <div key={index} className="flex gap-2">
                                        <Input
                                            value={redirectUri}
                                            onChange={(event) =>
                                                updateRedirectUri(
                                                    index,
                                                    event.target.value
                                                )
                                            }
                                            placeholder={t(
                                                "oauthClientRedirectUriPlaceholder"
                                            )}
                                        />
                                        {redirectUris.length > 1 && (
                                            <Button
                                                variant="outline"
                                                onClick={() =>
                                                    removeRedirectUri(index)
                                                }
                                            >
                                                {t(
                                                    "oauthClientRemoveRedirectUri"
                                                )}
                                            </Button>
                                        )}
                                    </div>
                                ))}
                                <Button
                                    variant="outline"
                                    onClick={() =>
                                        setRedirectUris((prev) => [
                                            ...prev,
                                            ""
                                        ])
                                    }
                                >
                                    {t("oauthClientAddRedirectUri")}
                                </Button>
                            </div>
                        </SettingsSectionForm>
                    </SettingsSectionBody>
                </SettingsSection>

                <SettingsSection>
                    <SettingsSectionHeader>
                        <SettingsSectionTitle>
                            {t("oauthClientScopesLabel")}
                        </SettingsSectionTitle>
                        <SettingsSectionDescription>
                            {t("oauthClientOpenidAlwaysEnabled")}
                        </SettingsSectionDescription>
                    </SettingsSectionHeader>
                    <SettingsSectionBody>
                        <SettingsSectionForm>
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <Checkbox
                                        checked={scopeProfile}
                                        onCheckedChange={(value) =>
                                            setScopeProfile(value === true)
                                        }
                                        id="scope-profile"
                                    />
                                    <Label htmlFor="scope-profile">
                                        {t("oauthClientScopeProfile")}
                                    </Label>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Checkbox
                                        checked={scopeEmail}
                                        onCheckedChange={(value) =>
                                            setScopeEmail(value === true)
                                        }
                                        id="scope-email"
                                    />
                                    <Label htmlFor="scope-email">
                                        {t("oauthClientScopeEmail")}
                                    </Label>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Checkbox
                                        checked={scopeGroups}
                                        onCheckedChange={(value) =>
                                            setScopeGroups(value === true)
                                        }
                                        id="scope-groups"
                                    />
                                    <Label htmlFor="scope-groups">
                                        {t("oauthClientScopeGroups")}
                                    </Label>
                                </div>
                            </div>
                        </SettingsSectionForm>
                    </SettingsSectionBody>
                </SettingsSection>

                <SettingsSection>
                    <SettingsSectionHeader>
                        <SettingsSectionTitle>
                            {t("oauthClientOptionsTitle")}
                        </SettingsSectionTitle>
                    </SettingsSectionHeader>
                    <SettingsSectionBody>
                        <SettingsSectionForm>
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <Label htmlFor="pkce-required">
                                        {t("oauthClientRequirePkceLabel")}
                                    </Label>
                                    <Switch
                                        id="pkce-required"
                                        checked={pkceRequired}
                                        onCheckedChange={setPkceRequired}
                                    />
                                </div>

                                <div className="flex items-center justify-between">
                                    <Label htmlFor="client-enabled">
                                        {t("oauthClientEnabledLabel")}
                                    </Label>
                                    <Switch
                                        id="client-enabled"
                                        checked={enabled}
                                        onCheckedChange={setEnabled}
                                    />
                                </div>
                            </div>
                        </SettingsSectionForm>
                    </SettingsSectionBody>
                </SettingsSection>
            </SettingsContainer>

            <div className="flex justify-end space-x-2 mt-8">
                <Button
                    variant="destructive"
                    onClick={() => setIsDeleteModalOpen(true)}
                >
                    {t("oauthClientDeleteButton")}
                </Button>
                <Button variant="outline" onClick={rotateSecret}>
                    {t("oauthClientRotateButton")}
                </Button>
                <Button
                    onClick={saveClient}
                    disabled={saving}
                    loading={saving}
                >
                    {t("saveChanges")}
                </Button>
            </div>
        </>
    );
}
