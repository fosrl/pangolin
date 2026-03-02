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
import { useTranslations } from "next-intl";
import { KeyRound, User, Mail, Users, ShieldQuestion } from "lucide-react";

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
            requestedScopes: z.array(z.string()),
            user: z.strictObject({
                name: z.string().nullable(),
                email: z.string().nullable(),
                username: z.string()
            })
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

const scopeDescriptionKeys: Record<string, string> = {
    openid: "oauthScopeOpenidDescription",
    profile: "oauthScopeProfileDescription",
    email: "oauthScopeEmailDescription",
    groups: "oauthScopeGroupsDescription"
};

const scopeIcons: Record<string, React.ComponentType<{ className?: string }>> =
    {
        openid: KeyRound,
        profile: User,
        email: Mail,
        groups: Users
    };

export default function ConsentPage({
    params
}: {
    params: OauthAuthorizeParams;
}) {
    const t = useTranslations();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [consentLoading, setConsentLoading] = useState(false);
    const [interaction, setInteraction] = useState<{
        interactionId: string;
        clientName: string;
        clientUri: string | null;
        logoUri: string | null;
        requestedScopes: string[];
        user: {
            name: string | null;
            email: string | null;
            username: string;
        };
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
            setError(t("oauthAuthorizeMissingParams"));
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
                        setError(t("oauthAuthorizeInvalidInitResponse"));
                    }
                    return;
                }

                const payload = parsedPayload.data;

                if (!res.ok) {
                    if (!cancelled) {
                        setError(
                            payload.message || t("oauthAuthorizeInitFailed")
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
                    setError(t("oauthAuthorizeConnectionFailed"));
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
                setError(t("oauthAuthorizeInvalidConsentResponse"));
                setConsentLoading(false);
                return;
            }

            const payload = parsedPayload.data;

            if (!res.ok) {
                setError(payload.message || t("oauthAuthorizeConsentFailed"));
                setConsentLoading(false);
                return;
            }

            window.location.href = payload.data.redirectTo;
        } catch {
            setError(t("oauthAuthorizeSubmitFailed"));
            setConsentLoading(false);
        }
    }

    return (
        <div>
            <Card className="w-full">
                <CardHeader>
                    <CardTitle>{t("oauthAuthorizeTitle")}</CardTitle>
                    <CardDescription>
                        {t("oauthAuthorizeDescription")}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {loading && (
                        <p className="text-sm text-muted-foreground">
                            {t("oauthAuthorizePreparing")}
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
                                {interaction.logoUri &&
                                    /^https?:\/\//.test(
                                        interaction.logoUri
                                    ) && (
                                        <img
                                            src={interaction.logoUri}
                                            alt={interaction.clientName}
                                            className="w-10 h-10 rounded"
                                        />
                                    )}

                                <div className="space-y-1">
                                    <p className="text-sm">
                                        <strong>
                                            {interaction.clientName}
                                        </strong>{" "}
                                        {t("oauthAuthorizeClientRequestAccess")}
                                    </p>
                                    {interaction.clientUri &&
                                        /^https?:\/\//.test(
                                            interaction.clientUri
                                        ) && (
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

                            <div className="rounded-md border px-4 py-3 text-sm text-muted-foreground overflow-hidden">
                                <p>
                                    {t("oauthAuthorizeSigningInAs")}{" "}
                                    <span className="font-medium text-foreground">
                                        {interaction.user.name || interaction.user.username}
                                    </span>
                                </p>
                                {interaction.user.email && (
                                    <p className="truncate">
                                        {interaction.user.email}
                                    </p>
                                )}
                            </div>

                            <div className="space-y-2">
                                <p className="text-sm font-medium">
                                    {t("oauthAuthorizeRequestedPermissions")}
                                </p>
                                <ul className="space-y-2">
                                    {interaction.requestedScopes.map(
                                        (scope) => {
                                            const Icon =
                                                scopeIcons[scope] ||
                                                ShieldQuestion;
                                            return (
                                                <li
                                                    key={scope}
                                                    className="border rounded-md px-4 py-3 flex items-center gap-3"
                                                >
                                                    <Icon className="size-4 md:size-5 shrink-0 text-muted-foreground" />
                                                    <div className="pl-2">
                                                        <p className="text-sm font-medium">
                                                            {scope}
                                                        </p>
                                                        <p className="text-xs text-muted-foreground">
                                                            {t(
                                                                scopeDescriptionKeys[
                                                                    scope
                                                                ] ||
                                                                    "oauthAuthorizeUnknownScopeDescription"
                                                            )}
                                                        </p>
                                                    </div>
                                                </li>
                                            );
                                        }
                                    )}
                                </ul>
                            </div>

                            <div className="flex gap-2 justify-end">
                                <Button
                                    variant="outline"
                                    onClick={() => submitConsent(false)}
                                    disabled={consentLoading}
                                >
                                    {t("deny")}
                                </Button>
                                <Button
                                    onClick={() => submitConsent(true)}
                                    disabled={consentLoading}
                                >
                                    {t("approve")}
                                </Button>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
