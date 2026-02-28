"use client";

import { useEffect, useMemo, useState } from "react";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from "@app/components/ui/card";
import { Button } from "@app/components/ui/button";
import { Alert, AlertDescription } from "@app/components/ui/alert";
import { z } from "zod";

type OauthAuthorizeParams = {
    response_type?: string;
    client_id?: string;
    redirect_uri?: string;
    scope?: string;
    state?: string;
    code_challenge?: string;
    code_challenge_method?: string;
    nonce?: string;
};

const initiateResponseSchema = z.strictObject({
    data: z.union([
        z.strictObject({
            redirectTo: z.string().min(1)
        }),
        z.strictObject({
            interactionId: z.string().min(1),
            clientName: z.string().min(1),
            clientUri: z.string().nullable(),
            logoUri: z.string().nullable(),
            requestedScopes: z.array(z.string())
        })
    ]),
    success: z.boolean(),
    error: z.boolean(),
    message: z.string(),
    status: z.number()
});

const consentResponseSchema = z.strictObject({
    data: z.strictObject({
        redirectTo: z.string().min(1)
    }),
    success: z.boolean(),
    error: z.boolean(),
    message: z.string(),
    status: z.number()
});

const scopeDescriptions: Record<string, string> = {
    openid: "Authenticate with your Pangolin account",
    profile: "Access your basic profile information",
    email: "Access your email address",
    groups: "Access your organization and role memberships"
};

export default function ConsentPage({
    params
}: {
    params: OauthAuthorizeParams;
}) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [consentLoading, setConsentLoading] = useState(false);
    const [interaction, setInteraction] = useState<{
        interactionId: string;
        clientName: string;
        clientUri: string | null;
        logoUri: string | null;
        requestedScopes: string[];
    } | null>(null);

    const isMissingRequiredParams = useMemo(() => {
        return (
            !params.response_type ||
            !params.client_id ||
            !params.redirect_uri ||
            !params.scope ||
            !params.state
        );
    }, [params]);

    useEffect(() => {
        if (isMissingRequiredParams) {
            setLoading(false);
            setError("Missing required OAuth parameters.");
            return;
        }

        let cancelled = false;

        const initiate = async () => {
            try {
                const res = await fetch("/api/v1/oauth/authorize/initiate", {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json",
                        "X-CSRF-Token": "x-csrf-protection"
                    },
                    body: JSON.stringify(params)
                });

                if (res.status === 401) {
                    const redirectPath = `${window.location.pathname}${window.location.search}`;
                    window.location.href = `/auth/login?redirect=${encodeURIComponent(redirectPath)}`;
                    return;
                }

                const parsedPayload = initiateResponseSchema.safeParse(
                    await res.json()
                );

                if (!parsedPayload.success) {
                    if (!cancelled) {
                        setError("Invalid OAuth authorization response.");
                    }
                    return;
                }

                const payload = parsedPayload.data;

                if (!res.ok) {
                    if (!cancelled) {
                        setError(
                            payload.message ||
                                "Failed to start OAuth authorization."
                        );
                    }
                    return;
                }

                if ("redirectTo" in payload.data) {
                    window.location.href = payload.data.redirectTo;
                    return;
                }

                if (!cancelled) {
                    setInteraction(payload.data);
                }
            } catch {
                if (!cancelled) {
                    setError("Failed to connect to Pangolin OAuth service.");
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        initiate();

        return () => {
            cancelled = true;
        };
    }, [isMissingRequiredParams, params]);

    async function submitConsent(approved: boolean) {
        if (!interaction) {
            return;
        }

        setConsentLoading(true);
        setError(null);

        try {
            const res = await fetch("/api/v1/oauth/authorize/consent", {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRF-Token": "x-csrf-protection"
                },
                body: JSON.stringify({
                    interactionId: interaction.interactionId,
                    approved
                })
            });

            const parsedPayload = consentResponseSchema.safeParse(
                await res.json()
            );

            if (!parsedPayload.success) {
                setError("Invalid OAuth consent response.");
                setConsentLoading(false);
                return;
            }

            const payload = parsedPayload.data;

            if (!res.ok) {
                setError(payload.message || "Failed to process OAuth consent.");
                setConsentLoading(false);
                return;
            }

            window.location.href = payload.data.redirectTo;
        } catch {
            setError("Failed to submit OAuth consent.");
            setConsentLoading(false);
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center px-4 py-8">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle>Authorize Application</CardTitle>
                    <CardDescription>
                        Review requested access before continuing.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {loading && (
                        <p className="text-sm text-muted-foreground">
                            Preparing authorization request...
                        </p>
                    )}

                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    {!loading && !error && interaction && (
                        <>
                            <div className="space-y-3">
                                {interaction.logoUri && (
                                    <img
                                        src={interaction.logoUri}
                                        alt={`${interaction.clientName} logo`}
                                        className="w-10 h-10 rounded"
                                    />
                                )}

                                <div className="space-y-1">
                                    <p className="text-sm">
                                        <strong>
                                            {interaction.clientName}
                                        </strong>{" "}
                                        wants to access your account.
                                    </p>
                                    {interaction.clientUri && (
                                        <a
                                            href={interaction.clientUri}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-xs text-muted-foreground underline"
                                        >
                                            {interaction.clientUri}
                                        </a>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <p className="text-sm font-medium">
                                    Requested permissions
                                </p>
                                <ul className="space-y-2">
                                    {interaction.requestedScopes.map(
                                        (scope) => (
                                            <li
                                                key={scope}
                                                className="border rounded-md p-2"
                                            >
                                                <p className="text-sm font-medium">
                                                    {scope}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {scopeDescriptions[scope] ||
                                                        "Access requested by the application"}
                                                </p>
                                            </li>
                                        )
                                    )}
                                </ul>
                            </div>

                            <div className="flex gap-2 justify-end">
                                <Button
                                    variant="outline"
                                    onClick={() => submitConsent(false)}
                                    disabled={consentLoading}
                                >
                                    Deny
                                </Button>
                                <Button
                                    onClick={() => submitConsent(true)}
                                    disabled={consentLoading}
                                >
                                    Allow
                                </Button>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
