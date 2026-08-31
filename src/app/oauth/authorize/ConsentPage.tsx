"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@app/components/ui/card";
import LoginCardHeader from "@app/components/LoginCardHeader";
import { Button } from "@app/components/ui/button";
import { Alert, AlertDescription } from "@app/components/ui/alert";
import { z } from "zod";
import { useTranslations } from "next-intl";
import {
    KeyRound,
    RefreshCcw,
    User,
    Mail,
    Users,
    ShieldQuestion
} from "lucide-react";
import ClientAvatar from "@app/components/ClientAvatar";
import { OFFLINE_ACCESS_SCOPE } from "@server/lib/oauth/scopes";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";

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

const redirectResponseSchema = z.strictObject({
    redirectTo: z.string().min(1)
});

const consentDataResponseSchema = z.strictObject({
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
});

const consentResponseSchema = z.strictObject({
    data: redirectResponseSchema,
    success: z.boolean(),
    error: z.boolean(),
    message: z.string(),
    status: z.number()
});

const initiateResponseSchema = consentResponseSchema.extend({
    data: z.xor([redirectResponseSchema, consentDataResponseSchema])
});

const scopeDescriptionKeys: Record<string, string> = {
    openid: "oauthScopeOpenidDescription",
    profile: "oauthScopeProfileDescription",
    email: "oauthScopeEmailDescription",
    groups: "oauthScopeGroupsDescription"
};

const scopeIcons: Record<
    string,
    React.ComponentType<{ className?: string }>
> = {
    openid: KeyRound,
    profile: User,
    email: Mail,
    groups: Users,
    [OFFLINE_ACCESS_SCOPE]: RefreshCcw
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

    const isMissingRequiredParams =
        !params.response_type ||
        !params.client_id ||
        !params.redirect_uri ||
        !params.scope;

    const { env } = useEnvContext();
    const api = createApiClient({ env });

    useEffect(() => {
        if (isMissingRequiredParams) {
            setLoading(false);
            setError(t("oauthAuthorizeMissingParams"));
            return;
        }

        let cancelled = false;

        const initiate = async () => {
            try {
                const res = await api.post("/oauth/authorize/initiate", params);

                if (res.status === 401) {
                    const redirectPath = `${window.location.pathname}${window.location.search}`;
                    window.location.href = `/auth/login?redirect=${encodeURIComponent(redirectPath)}`;
                    return;
                }

                if (res.status !== 200) {
                    if (cancelled) return;
                    setError(
                        res.data?.message || t("oauthAuthorizeInitFailed")
                    );
                    return;
                }

                const parsedPayload = initiateResponseSchema.safeParse(
                    res.data
                );

                if (!parsedPayload.success || !parsedPayload.data) {
                    if (cancelled) return;
                    setError(t("oauthAuthorizeInvalidInitResponse"));
                    return;
                }

                const payload = parsedPayload.data;

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
            const res = await api.post("/oauth/authorize/consent", {
                interactionId: interaction.interactionId,
                approved
            });

            if (res.status !== 200) {
                setError(res.data?.message || t("oauthAuthorizeConsentFailed"));
                setConsentLoading(false);
                return;
            }

            const parsedPayload = consentResponseSchema.safeParse(res.data);

            if (!parsedPayload.success) {
                setError(t("oauthAuthorizeInvalidConsentResponse"));
                setConsentLoading(false);
                return;
            }

            window.location.href = parsedPayload.data.data.redirectTo;
        } catch {
            setError(t("oauthAuthorizeSubmitFailed"));
            setConsentLoading(false);
        }
    }

    return (
        <div>
            <Card className="w-full">
                <LoginCardHeader subtitle={t("oauthAuthorizeDescription")} />
                <CardContent className="pt-6 space-y-4">
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
                            <div className="flex items-start gap-3">
                                <ClientAvatar
                                    name={interaction.clientName}
                                    logoUri={interaction.logoUri}
                                    className="shrink-0 mt-0.5"
                                />
                                <div className="space-y-1 min-w-0">
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
                                                className="text-xs text-muted-foreground underline truncate block"
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
                                        {interaction.user.name ||
                                            interaction.user.username}
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
                                                        <p className="text-sm font-medium capitalize">
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
                                    variant="ghost"
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
