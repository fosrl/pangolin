"use client";

import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionFooter,
    SettingsSectionForm,
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
import { Input } from "@app/components/ui/input";
import { Label } from "@app/components/ui/label";
import { Checkbox } from "@app/components/ui/checkbox";
import { Switch } from "@app/components/ui/switch";
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

type OAuthClient = {
    clientId: string;
    clientName: string;
    clientUri: string | null;
    logoUri: string | null;
    backchannelLogoutUri: string | null;
    postLogoutRedirectUris: string[] | null;
    redirectUris: string[];
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

    const orgId = params.orgId as string;
    const clientId = params.clientId as string;

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [clientName, setClientName] = useState("");
    const [clientUri, setClientUri] = useState("");
    const [logoUri, setLogoUri] = useState("");
    const [backchannelLogoutUri, setBackchannelLogoutUri] = useState("");
    const [postLogoutRedirectUris, setPostLogoutRedirectUris] = useState<string[]>([""]);
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
    const [showOptional, setShowOptional] = useState(false);
    const [isRotateModalOpen, setIsRotateModalOpen] = useState(false);
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
                setBackchannelLogoutUri(client.backchannelLogoutUri || "");
                const postLogoutUris = client.postLogoutRedirectUris ?? [];
                setPostLogoutRedirectUris(
                    postLogoutUris.length > 0 ? postLogoutUris : [""]
                );
                setRedirectUris(
                    client.redirectUris.length > 0
                        ? client.redirectUris
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

    function updatePostLogoutRedirectUri(index: number, value: string) {
        setPostLogoutRedirectUris((prev) =>
            prev.map((item, i) => (i === index ? value : item))
        );
    }

    function removePostLogoutRedirectUri(index: number) {
        setPostLogoutRedirectUris((prev) => prev.filter((_, i) => i !== index));
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

            const cleanedPostLogoutRedirectUris = postLogoutRedirectUris
                .map((item) => item.trim())
                .filter((item) => item.length > 0);

            await api.patch(`/org/${orgId}/oauth-clients/${clientId}`, {
                clientName: clientName.trim(),
                redirectUris: cleanedRedirectUris,
                clientUri: clientUri.trim() || undefined,
                logoUri: logoUri.trim() || undefined,
                backchannelLogoutUri: backchannelLogoutUri.trim() || null,
                postLogoutRedirectUris: cleanedPostLogoutRedirectUris.length > 0
                    ? cleanedPostLogoutRedirectUris
                    : null,
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
                                    <CopyTextBox text={rotatedSecret.clientId} wrapText />
                                </div>
                                <div className="space-y-1">
                                    <Label>{t("oauthClientSecretLabel")}</Label>
                                    <CopyTextBox text={rotatedSecret.clientSecret} wrapText />
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
                            <Button variant="outline">
                                {t("cancel")}
                            </Button>
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
                string={clientName}
                title={t("oauthClientDeleteButton")}
            />

            <SettingsContainer>
                <SettingsSection>
                    <div className="flex items-center justify-between pb-4 mb-4">
                        <div className="flex items-center gap-3">
                            {logoUri && /^https?:\/\//.test(logoUri) ? (
                                <img
                                    src={logoUri}
                                    alt={clientName}
                                    className="w-8 h-8 rounded object-contain"
                                />
                            ) : (
                                <div className="w-8 h-8 rounded bg-muted flex items-center justify-center text-sm font-medium text-muted-foreground">
                                    {clientName.charAt(0).toUpperCase()}
                                </div>
                            )}
                            <span className="font-medium text-lg truncate">
                                {clientName}
                            </span>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowOptional((prev) => !prev)}
                        >
                            {showOptional
                                ? t("oauthClientHideOptionalFields")
                                : t("oauthClientShowOptionalFields")}
                        </Button>
                    </div>
                    <SettingsSectionBody>
                        <SettingsSectionForm>
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

                            {(showOptional || clientUri.trim()) && (
                                <div className="space-y-2">
                                    <Label htmlFor="client-uri">
                                        {t("oauthClientHomepageLabel")} <span className="text-muted-foreground font-normal">(optional)</span>
                                    </Label>
                                    <Input
                                        id="client-uri"
                                        value={clientUri}
                                        onChange={(event) =>
                                            setClientUri(event.target.value)
                                        }
                                    />
                                </div>
                            )}

                            {(showOptional || logoUri.trim()) && (
                                <div className="space-y-2">
                                    <Label htmlFor="logo-uri">
                                        {t("oauthClientLogoLabel")} <span className="text-muted-foreground font-normal">(optional)</span>
                                    </Label>
                                    <Input
                                        id="logo-uri"
                                        value={logoUri}
                                        onChange={(event) =>
                                            setLogoUri(event.target.value)
                                        }
                                    />
                                </div>
                            )}

                            {(showOptional || backchannelLogoutUri.trim()) && (
                                <div className="space-y-2">
                                    <Label htmlFor="backchannel-logout-uri">
                                        {t("oauthClientBackchannelLogoutUriLabel")} <span className="text-muted-foreground font-normal">(optional)</span>
                                    </Label>
                                    <Input
                                        id="backchannel-logout-uri"
                                        value={backchannelLogoutUri}
                                        onChange={(event) =>
                                            setBackchannelLogoutUri(event.target.value)
                                        }
                                    />
                                </div>
                            )}

                            {(showOptional || postLogoutRedirectUris.some(u => u.trim())) && (
                                <div className="space-y-2">
                                    <Label>
                                        {t("oauthClientPostLogoutRedirectUrisLabel")} <span className="text-muted-foreground font-normal">(optional)</span>
                                    </Label>
                                    <div className="space-y-3">
                                        {postLogoutRedirectUris.map((uri, index) => (
                                            <div key={index} className="flex gap-2">
                                                <Input
                                                    value={uri}
                                                    onChange={(event) =>
                                                        updatePostLogoutRedirectUri(
                                                            index,
                                                            event.target.value
                                                        )
                                                    }
                                                    placeholder={t(
                                                        "oauthClientPostLogoutRedirectUriPlaceholder"
                                                    )}
                                                />
                                                {postLogoutRedirectUris.length > 1 && (
                                                    <Button
                                                        variant="outline"
                                                        onClick={() =>
                                                            removePostLogoutRedirectUri(index)
                                                        }
                                                    >
                                                        {t("oauthClientRemovePostLogoutRedirectUri")}
                                                    </Button>
                                                )}
                                            </div>
                                        ))}
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                                setPostLogoutRedirectUris((prev) => [
                                                    ...prev,
                                                    ""
                                                ])
                                            }
                                        >
                                            {t("oauthClientAddPostLogoutRedirectUri")}
                                        </Button>
                                    </div>
                                </div>
                            )}

                            <div className="space-y-2 pt-2">
                                <Label>
                                    {t("oauthClientRedirectUrisLabel")}
                                </Label>
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
                                        size="sm"
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
                            </div>

                            <div className="space-y-2 pt-2">
                                <Label>
                                    {t("oauthClientScopesLabel")}
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                    {t("oauthClientOpenidAlwaysEnabled")}
                                </p>
                                <div className="space-y-3 pt-1">
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
                            </div>

                            <div className="space-y-4 pt-2">
                                <Label>
                                    {t("oauthClientOptionsTitle")}
                                </Label>
                                <div className="flex items-center justify-between">
                                    <Label htmlFor="pkce-required" className="font-normal">
                                        {t("oauthClientRequirePkceLabel")}
                                    </Label>
                                    <Switch
                                        id="pkce-required"
                                        checked={pkceRequired}
                                        onCheckedChange={setPkceRequired}
                                    />
                                </div>

                                <div className="flex items-center justify-between">
                                    <Label htmlFor="client-enabled" className="font-normal">
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

                    <SettingsSectionFooter>
                        <Button variant="outline" onClick={() => setIsRotateModalOpen(true)}>
                            {t("oauthClientRotateButton")}
                        </Button>
                        <Button
                            onClick={saveClient}
                            disabled={saving}
                            loading={saving}
                        >
                            {t("saveChanges")}
                        </Button>
                    </SettingsSectionFooter>
                </SettingsSection>

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
