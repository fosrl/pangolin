"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
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

function parseRedirectUris(redirectUris: string): string[] {
    try {
        const parsed = JSON.parse(redirectUris);
        if (Array.isArray(parsed)) {
            return parsed.filter((item) => typeof item === "string");
        }
        return [];
    } catch {
        return [];
    }
}

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
                    title: "Failed to load OAuth client",
                    description: formatAxiosError(error)
                });
            } finally {
                setLoading(false);
            }
        };

        load();
    }, [orgId, clientId]);

    function updateRedirectUri(index: number, value: string) {
        setRedirectUris((prev) => prev.map((item, i) => (i === index ? value : item)));
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
                title: "Client name is required"
            });
            return;
        }

        if (cleanedRedirectUris.length === 0) {
            toast({
                variant: "destructive",
                title: "At least one redirect URI is required"
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
                title: "OAuth client updated",
                description: "Changes saved successfully."
            });
        } catch (error) {
            toast({
                variant: "destructive",
                title: "Failed to update OAuth client",
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
                title: "Secret rotated",
                description: "A new client secret was issued."
            });
        } catch (error) {
            toast({
                variant: "destructive",
                title: "Failed to rotate secret",
                description: formatAxiosError(error)
            });
        }
    }

    async function deleteClient() {
        if (!confirm("Delete this OAuth client?")) {
            return;
        }

        try {
            await api.delete(`/org/${orgId}/oauth-clients/${clientId}`);
            toast({
                title: "OAuth client deleted",
                description: "The OAuth client was deleted successfully."
            });
            router.push(`/${orgId}/settings/oauth-clients`);
        } catch (error) {
            toast({
                variant: "destructive",
                title: "Failed to delete OAuth client",
                description: formatAxiosError(error)
            });
        }
    }

    return (
        <>
            <SettingsSectionTitle
                title="Edit OAuth Client"
                description="Update client settings, rotate secrets, or delete this client."
            />

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
                        <DialogTitle>New Client Secret</DialogTitle>
                        <DialogDescription>
                            This secret is shown only once. Save it now.
                        </DialogDescription>
                    </DialogHeader>
                    {rotatedSecret && (
                        <CopyTextBox
                            text={`${rotatedSecret.clientId}.${rotatedSecret.clientSecret}`}
                            wrapText
                        />
                    )}
                </DialogContent>
            </Dialog>

            {loading ? (
                <p className="text-sm text-muted-foreground">Loading OAuth client...</p>
            ) : (
                <div className="space-y-6 max-w-2xl">
                    <div className="space-y-2">
                        <Label htmlFor="client-name">Client Name</Label>
                        <Input
                            id="client-name"
                            value={clientName}
                            onChange={(event) => setClientName(event.target.value)}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="client-uri">Homepage URL (optional)</Label>
                        <Input
                            id="client-uri"
                            value={clientUri}
                            onChange={(event) => setClientUri(event.target.value)}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="logo-uri">Logo URL (optional)</Label>
                        <Input
                            id="logo-uri"
                            value={logoUri}
                            onChange={(event) => setLogoUri(event.target.value)}
                        />
                    </div>

                    <div className="space-y-3">
                        <Label>Redirect URIs</Label>
                        {redirectUris.map((redirectUri, index) => (
                            <div key={index} className="flex gap-2">
                                <Input
                                    value={redirectUri}
                                    onChange={(event) =>
                                        updateRedirectUri(index, event.target.value)
                                    }
                                />
                                {redirectUris.length > 1 && (
                                    <Button
                                        variant="outline"
                                        onClick={() => removeRedirectUri(index)}
                                    >
                                        Remove
                                    </Button>
                                )}
                            </div>
                        ))}
                        <Button
                            variant="outline"
                            onClick={() => setRedirectUris((prev) => [...prev, ""])}
                        >
                            Add Redirect URI
                        </Button>
                    </div>

                    <div className="space-y-3">
                        <Label>Scopes</Label>
                        <div className="text-xs text-muted-foreground">openid is always enabled.</div>
                        <div className="flex items-center gap-2">
                            <Checkbox
                                checked={scopeProfile}
                                onCheckedChange={(value) => setScopeProfile(value === true)}
                                id="scope-profile"
                            />
                            <Label htmlFor="scope-profile">profile</Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <Checkbox
                                checked={scopeEmail}
                                onCheckedChange={(value) => setScopeEmail(value === true)}
                                id="scope-email"
                            />
                            <Label htmlFor="scope-email">email</Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <Checkbox
                                checked={scopeGroups}
                                onCheckedChange={(value) => setScopeGroups(value === true)}
                                id="scope-groups"
                            />
                            <Label htmlFor="scope-groups">groups</Label>
                        </div>
                    </div>

                    <div className="flex items-center justify-between">
                        <Label htmlFor="pkce-required">Require PKCE</Label>
                        <Switch
                            id="pkce-required"
                            checked={pkceRequired}
                            onCheckedChange={setPkceRequired}
                        />
                    </div>

                    <div className="flex items-center justify-between">
                        <Label htmlFor="client-enabled">Enabled</Label>
                        <Switch
                            id="client-enabled"
                            checked={enabled}
                            onCheckedChange={setEnabled}
                        />
                    </div>

                    <div className="flex gap-2 flex-wrap">
                        <Button onClick={saveClient} disabled={saving}>
                            {saving ? "Saving..." : "Save Changes"}
                        </Button>
                        <Button variant="outline" onClick={rotateSecret}>
                            Rotate Secret
                        </Button>
                        <Button variant="destructive" onClick={deleteClient}>
                            Delete Client
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => router.push(`/${orgId}/settings/oauth-clients`)}
                        >
                            Back
                        </Button>
                    </div>
                </div>
            )}
        </>
    );
}
