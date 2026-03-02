"use client";

import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionFooter,
    SettingsSectionForm
} from "@app/components/Settings";
import SettingsHeaderTitle from "@app/components/SettingsSectionTitle";
import { useState } from "react";
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
import { useTranslations } from "next-intl";

type CreateResponse = {
    data: {
        clientId: string;
        clientSecret: string;
    };
    success: boolean;
    error: boolean;
    message: string;
    status: number;
};

export default function CreateOAuthClientPage() {
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const params = useParams();
    const router = useRouter();
    const t = useTranslations();

    const orgId = params.orgId as string;

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
    const [showOptional, setShowOptional] = useState(false);
    const [creating, setCreating] = useState(false);
    const [createdSecret, setCreatedSecret] = useState<{
        clientId: string;
        clientSecret: string;
    } | null>(null);

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

    async function createClient() {
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

        setCreating(true);

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

            const res = await api.post<CreateResponse>(
                `/org/${orgId}/oauth-clients`,
                {
                    clientName: clientName.trim(),
                    redirectUris: cleanedRedirectUris,
                    clientUri: clientUri.trim() || undefined,
                    logoUri: logoUri.trim() || undefined,
                    backchannelLogoutUri: backchannelLogoutUri.trim() || undefined,
                    postLogoutRedirectUris: cleanedPostLogoutRedirectUris.length > 0
                        ? cleanedPostLogoutRedirectUris
                        : undefined,
                    scopes,
                    pkceRequired,
                    enabled
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
                                    {(clientName.charAt(0) || "?").toUpperCase()}
                                </div>
                            )}
                            <span className="font-medium text-lg truncate">
                                {clientName || t("oauthClientsCreateTitle")}
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
                                        {t("oauthClientHomepageLabel")} <span className="text-muted-foreground font-normal">{t("optional")}</span>
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
                                        {t("oauthClientLogoLabel")} <span className="text-muted-foreground font-normal">{t("optional")}</span>
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
                                        {t("oauthClientBackchannelLogoutUriLabel")} <span className="text-muted-foreground font-normal">{t("optional")}</span>
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
                                        {t("oauthClientPostLogoutRedirectUrisLabel")} <span className="text-muted-foreground font-normal">{t("optional")}</span>
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
                        <Button
                            variant="outline"
                            onClick={() =>
                                router.push(`/${orgId}/settings/oauth-clients`)
                            }
                        >
                            {t("cancel")}
                        </Button>
                        <Button
                            onClick={createClient}
                            disabled={creating}
                            loading={creating}
                        >
                            {t("oauthClientCreateButton")}
                        </Button>
                    </SettingsSectionFooter>
                </SettingsSection>
            </SettingsContainer>
        </>
    );
}
