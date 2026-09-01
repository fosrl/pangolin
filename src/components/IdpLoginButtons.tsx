"use client";

import { generateOidcUrlProxy } from "@app/actions/server";
import IdpTypeIcon from "@app/components/IdpTypeIcon";
import { Alert, AlertDescription } from "@app/components/ui/alert";
import { Button } from "@app/components/ui/button";
import { cleanRedirect } from "@app/lib/cleanRedirect";
import { LAST_USED_IDP_COOKIE_NAME } from "@app/lib/consts";
import { setClientCookie } from "@app/lib/setClientCookie";
import { useTranslations } from "next-intl";
import {
    redirect as redirectTo,
    useRouter,
    useSearchParams
} from "next/navigation";
import { useEffect, useState, useTransition } from "react";

export type LoginFormIDP = {
    idpId: number;
    name: string;
    variant?: string;
    lastUsed?: boolean;
};

type IdpLoginButtonsProps = {
    idps: LoginFormIDP[];
    redirect?: string;
    orgId?: string;
    passOrgIdToOidcUrl?: boolean;
};

export default function IdpLoginButtons({
    idps,
    redirect,
    orgId,
    passOrgIdToOidcUrl = true
}: IdpLoginButtonsProps) {
    const [error, setError] = useState<string | null>(null);
    const t = useTranslations();

    const params = useSearchParams();
    const router = useRouter();

    function goToApp() {
        const url = window.location.href.split("?")[0];
        router.push(url);
    }

    useEffect(() => {
        if (params.get("gotoapp")) {
            goToApp();
        }
    }, []);

    const [loading, startTransition] = useTransition();

    async function loginWithIdp(idpId: number) {
        setError(null);

        setClientCookie(
            LAST_USED_IDP_COOKIE_NAME,
            JSON.stringify({
                orgId,
                idpId
            }),
            {
                sameSite: "Lax"
            }
        );

        let redirectToUrl: string | undefined;
        try {
            const oidcOrgId = passOrgIdToOidcUrl ? orgId : undefined;
            console.log("generating", idpId, redirect || "/", oidcOrgId);
            const safeRedirect = cleanRedirect(redirect || "/");
            const response = await generateOidcUrlProxy(
                idpId,
                safeRedirect,
                oidcOrgId
            );

            if (response.error) {
                setError(response.message);
                return;
            }

            const data = response.data;
            if (data?.redirectUrl) {
                redirectToUrl = data.redirectUrl;
            }
        } catch (e: any) {
            console.error(e);
            setError(
                t("loginError", {
                    defaultValue:
                        "An unexpected error occurred. Please try again."
                })
            );
        }

        if (redirectToUrl) {
            redirectTo(redirectToUrl);
        }
    }

    if (!idps || idps.length === 0) {
        return null;
    }

    return (
        <div className="space-y-4">
            {error && (
                <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            <div className="space-y-4">
                {params.get("gotoapp") ? (
                    <Button
                        type="button"
                        className="w-full"
                        onClick={() => {
                            goToApp();
                        }}
                    >
                        {t("continueToApplication")}
                    </Button>
                ) : (
                    idps.map((idp) => {
                        const effectiveType =
                            idp.variant || idp.name.toLowerCase();

                        return (
                            <div className="w-full relative" key={idp.idpId}>
                                <Button
                                    key={idp.idpId}
                                    type="button"
                                    variant="outline"
                                    className="w-full inline-flex items-center space-x-2  after:absolute after:inset-0 after:z-10"
                                    onClick={() => {
                                        startTransition(() =>
                                            loginWithIdp(idp.idpId)
                                        );
                                    }}
                                    disabled={loading}
                                    loading={loading}
                                >
                                    <IdpTypeIcon
                                        type={effectiveType}
                                        size={16}
                                    />
                                    <span>{idp.name}</span>
                                </Button>

                                {idp.lastUsed && (
                                    <div className="absolute inset-0">
                                        <span className="absolute top-0 right-0 text-xs bg-primary text-primary-foreground rounded-bl-sm rounded-tr-sm px-2 py-0.5">
                                            {t("idpLastUsed")}
                                        </span>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
