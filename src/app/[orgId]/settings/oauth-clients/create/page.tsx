"use client";

import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionFooter,
    SettingsSectionForm
} from "@app/components/Settings";
import SettingsHeaderTitle from "@app/components/SettingsSectionTitle";
import { useMemo, useState } from "react";
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

    const orgId = useMemo(() => {
        const rawOrgId = params.orgId;
        if (Array.isArray(rawOrgId)) {
            return rawOrgId[0];
        }
        return rawOrgId || "";
    }, [params.orgId]);

    const [clientName, setClientName] = useState("");
    const [clientUri, setClientUri] = useState("");
    const [logoUri, setLogoUri] = useState("");
    const [redirectUris, setRedirectUris] = useState<string[]>([""]);
    const [scopeProfile, setScopeProfile] = useState(true);
    const [scopeEmail, setScopeEmail] = useState(true);
    const [scopeGroups, setScopeGroups] = useState(false);
    const [pkceRequired, setPkceRequired] = useState(true);
    const [enabled, setEnabled] = useState(true);
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

            const res = await api.post<CreateResponse>(
                `/org/${orgId}/oauth-clients`,
                {
                    clientName: clientName.trim(),
                    redirectUris: cleanedRedirectUris,
                    clientUri: clientUri.trim() || undefined,
                    logoUri: logoUri.trim() || undefined,
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

            <Dialog
                open={Boolean(createdSecret)}
                onOpenChange={(open) => {
                    if (!open) {
                        setCreatedSecret(null);
                        router.push(`/${orgId}/settings/oauth-clients`);
                    }
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {t("oauthClientSecretDialogTitle")}
                        </DialogTitle>
                        <DialogDescription>
                            {t("oauthClientSecretDialogDescription")}
                        </DialogDescription>
                    </DialogHeader>
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
                </DialogContent>
            </Dialog>

            <SettingsContainer>
                <SettingsSection>
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
