"use client";

import { type ReactNode, useState } from "react";
import {
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionFooter,
    SettingsSectionForm
} from "@app/components/Settings";
import { toast } from "@app/hooks/useToast";
import { Button } from "@app/components/ui/button";
import { Input } from "@app/components/ui/input";
import { Label } from "@app/components/ui/label";
import { Checkbox } from "@app/components/ui/checkbox";
import { Switch } from "@app/components/ui/switch";
import CopyTextBox from "@app/components/CopyTextBox";
import { useTranslations } from "next-intl";
import ClientAvatar from "@app/components/ClientAvatar";

export type OAuthClientFormData = {
    clientName: string;
    redirectUris: string[];
    clientUri: string;
    logoUri: string;
    backchannelLogoutUri: string;
    postLogoutRedirectUris: string[];
    scopes: string[];
    pkceRequired: boolean;
    enabled: boolean;
};

type OAuthClientFormProps = {
    initialValues?: {
        clientName?: string;
        clientUri?: string;
        logoUri?: string;
        backchannelLogoutUri?: string;
        postLogoutRedirectUris?: string[];
        redirectUris?: string[];
        scopeProfile?: boolean;
        scopeEmail?: boolean;
        scopeGroups?: boolean;
        pkceRequired?: boolean;
        enabled?: boolean;
    };
    clientId?: string;
    onSubmit: (data: OAuthClientFormData) => void;
    submitting: boolean;
    submitLabel: string;
    avatarFallback?: string;
    footerExtra?: ReactNode;
};

export default function OAuthClientForm({
    initialValues,
    clientId,
    onSubmit,
    submitting,
    submitLabel,
    avatarFallback,
    footerExtra
}: OAuthClientFormProps) {
    const t = useTranslations();

    const [clientName, setClientName] = useState(initialValues?.clientName ?? "");
    const [clientUri, setClientUri] = useState(initialValues?.clientUri ?? "");
    const [logoUri, setLogoUri] = useState(initialValues?.logoUri ?? "");
    const [backchannelLogoutUri, setBackchannelLogoutUri] = useState(initialValues?.backchannelLogoutUri ?? "");
    const [postLogoutRedirectUris, setPostLogoutRedirectUris] = useState<string[]>(
        initialValues?.postLogoutRedirectUris ?? [""]
    );
    const [redirectUris, setRedirectUris] = useState<string[]>(
        initialValues?.redirectUris ?? [""]
    );
    const [scopeProfile, setScopeProfile] = useState(initialValues?.scopeProfile ?? true);
    const [scopeEmail, setScopeEmail] = useState(initialValues?.scopeEmail ?? true);
    const [scopeGroups, setScopeGroups] = useState(initialValues?.scopeGroups ?? false);
    const [pkceRequired, setPkceRequired] = useState(initialValues?.pkceRequired ?? true);
    const [enabled, setEnabled] = useState(initialValues?.enabled ?? true);
    const [showOptional, setShowOptional] = useState(false);

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

    function handleSubmit() {
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

        const scopes = ["openid"];
        if (scopeProfile) scopes.push("profile");
        if (scopeEmail) scopes.push("email");
        if (scopeGroups) scopes.push("groups");

        const cleanedPostLogoutRedirectUris = postLogoutRedirectUris
            .map((item) => item.trim())
            .filter((item) => item.length > 0);

        onSubmit({
            clientName: clientName.trim(),
            redirectUris: cleanedRedirectUris,
            clientUri: clientUri.trim(),
            logoUri: logoUri.trim(),
            backchannelLogoutUri: backchannelLogoutUri.trim(),
            postLogoutRedirectUris: cleanedPostLogoutRedirectUris,
            scopes,
            pkceRequired,
            enabled
        });
    }

    return (
        <SettingsSection>
            <div className="flex items-center justify-between pb-4 mb-4">
                <div className="flex items-center gap-3">
                    <ClientAvatar name={clientName} logoUri={logoUri} />
                    <span className="font-medium text-lg truncate">
                        {clientName || avatarFallback}
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
                    {clientId && (
                        <div className="space-y-2">
                            <Label>
                                {t("oauthClientIdHeader")}
                            </Label>
                            <CopyTextBox text={clientId} />
                        </div>
                    )}

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
                {footerExtra}
                <Button
                    onClick={handleSubmit}
                    disabled={submitting}
                    loading={submitting}
                >
                    {submitLabel}
                </Button>
            </SettingsSectionFooter>
        </SettingsSection>
    );
}
