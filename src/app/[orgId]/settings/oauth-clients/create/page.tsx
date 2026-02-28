"use client";

import { useMemo, useState } from "react";
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
        setRedirectUris((prev) => prev.map((item, i) => (i === index ? value : item)));
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

            const res = await api.post<CreateResponse>(`/org/${orgId}/oauth-clients`, {
                clientName: clientName.trim(),
                redirectUris: cleanedRedirectUris,
                clientUri: clientUri.trim() || undefined,
                logoUri: logoUri.trim() || undefined,
                scopes,
                pkceRequired,
                enabled
            });

            setCreatedSecret(res.data.data);
            toast({
                title: "OAuth client created",
                description: "Save the secret now. It will not be shown again."
            });
        } catch (error) {
            toast({
                variant: "destructive",
                title: "Failed to create OAuth client",
                description: formatAxiosError(error)
            });
        } finally {
            setCreating(false);
        }
    }

    return (
        <>
            <SettingsSectionTitle
                title="Create OAuth Client"
                description="Register an application to use Login with Pangolin."
            />

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
                        <DialogTitle>Client Secret</DialogTitle>
                        <DialogDescription>
                            This secret is shown only once. Store it in your application now.
                        </DialogDescription>
                    </DialogHeader>

                    {createdSecret && (
                        <CopyTextBox
                            text={`${createdSecret.clientId}.${createdSecret.clientSecret}`}
                            wrapText
                        />
                    )}
                </DialogContent>
            </Dialog>

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
                                placeholder="https://app.example.com/callback"
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

                <div className="flex gap-2">
                    <Button onClick={createClient} disabled={creating}>
                        {creating ? "Creating..." : "Create OAuth Client"}
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => router.push(`/${orgId}/settings/oauth-clients`)}
                    >
                        Cancel
                    </Button>
                </div>
            </div>
        </>
    );
}
