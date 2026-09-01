"use client";

import { useEffect, useState } from "react";
import { Button } from "@app/components/ui/button";
import { Badge } from "@app/components/ui/badge";
import { Alert, AlertDescription } from "@app/components/ui/alert";
import { useTranslations } from "next-intl";
import LoginPasswordForm from "@app/components/LoginPasswordForm";
import { LookupUserResponse } from "@server/routers/auth/lookupUser";
import UserProfileCard from "@app/components/UserProfileCard";
import IdpTypeIcon from "@app/components/IdpTypeIcon";
import { generateOidcUrlProxy } from "@app/actions/server";
import {
    redirect as redirectTo,
    useRouter,
    useSearchParams
} from "next/navigation";
import { cleanRedirect } from "@app/lib/cleanRedirect";
import { Separator } from "@app/components/ui/separator";
import { setClientCookie } from "@app/lib/setClientCookie";
import { LAST_USED_IDP_COOKIE_NAME } from "@app/lib/consts";

type SmartLoginOrgSelectorProps = {
    identifier: string;
    lookupResult: LookupUserResponse;
    redirect?: string;
    forceLogin?: boolean;
    onUseDifferentAccount?: () => void;
};

type OrgBucket = {
    orgId: string;
    orgName: string;
    idps: Array<{
        idpId: number;
        name: string;
        variant: string | null;
    }>;
    hasInternalAuth: boolean;
};

type GroupedLoginIdp = {
    idpId: number;
    name: string;
    variant: string | null;
    orgs: { orgId: string; orgName: string }[];
};

function buildOrgMap(lookupResult: LookupUserResponse) {
    const orgMap = new Map<string, OrgBucket>();

    for (const account of lookupResult.accounts) {
        for (const org of account.orgs) {
            if (!orgMap.has(org.orgId)) {
                orgMap.set(org.orgId, {
                    orgId: org.orgId,
                    orgName: org.orgName,
                    idps: org.idps,
                    hasInternalAuth: org.hasInternalAuth
                });
            } else {
                const existing = orgMap.get(org.orgId)!;
                const existingIdpIds = new Set(
                    existing.idps.map((i) => i.idpId)
                );
                for (const idp of org.idps) {
                    if (!existingIdpIds.has(idp.idpId)) {
                        existing.idps.push(idp);
                    }
                }
                if (org.hasInternalAuth) {
                    existing.hasInternalAuth = true;
                }
            }
        }
    }

    return Array.from(orgMap.values());
}

function groupIdpsAcrossOrgs(orgs: OrgBucket[]): GroupedLoginIdp[] {
    const map = new Map<number, GroupedLoginIdp>();

    for (const org of orgs) {
        for (const idp of org.idps) {
            let g = map.get(idp.idpId);
            if (!g) {
                g = {
                    idpId: idp.idpId,
                    name: idp.name,
                    variant: idp.variant,
                    orgs: []
                };
                map.set(idp.idpId, g);
            }
            if (!g.orgs.some((o) => o.orgId === org.orgId)) {
                g.orgs.push({ orgId: org.orgId, orgName: org.orgName });
            }
        }
    }

    return Array.from(map.values())
        .map((g) => ({
            ...g,
            orgs: [...g.orgs].sort((a, b) => a.orgName.localeCompare(b.orgName))
        }))
        .sort((a, b) => b.name.localeCompare(a.name));
}

export default function SmartLoginOrgSelector({
    identifier,
    lookupResult,
    redirect,
    forceLogin,
    onUseDifferentAccount
}: SmartLoginOrgSelectorProps) {
    const t = useTranslations();
    const [showPasswordForm, setShowPasswordForm] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pendingIdpId, setPendingIdpId] = useState<number | null>(null);
    const params = useSearchParams();
    const router = useRouter();

    const orgs = buildOrgMap(lookupResult);
    const groupedIdps = groupIdpsAcrossOrgs(orgs);

    const hasInternalAccount = lookupResult.accounts.some(
        (acc) => acc.hasInternalAuth
    );

    function goToApp() {
        const url = window.location.href.split("?")[0];
        router.push(url);
    }

    useEffect(() => {
        if (params.get("gotoapp")) {
            goToApp();
        }
    }, []);

    async function loginWithIdp(idpId: number, orgId: string) {
        setPendingIdpId(idpId);
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
            const safeRedirect = cleanRedirect(redirect || "/");
            const response = await generateOidcUrlProxy(
                idpId,
                safeRedirect,
                undefined,
                forceLogin
            );

            if (response.error) {
                setError(response.message);
                setPendingIdpId(null);
                return;
            }

            const data = response.data;
            if (data?.redirectUrl) {
                redirectToUrl = data.redirectUrl;
            }
        } catch {
            setError(
                t("loginError", {
                    defaultValue:
                        "An unexpected error occurred. Please try again."
                })
            );
        }

        if (redirectToUrl) {
            redirectTo(redirectToUrl);
        } else {
            setPendingIdpId(null);
        }
    }

    if (showPasswordForm) {
        return (
            <div className="space-y-4">
                <UserProfileCard
                    identifier={identifier}
                    description={t("loginSelectAuthenticationMethod")}
                    onUseDifferentAccount={onUseDifferentAccount}
                    useDifferentAccountText={t(
                        "deviceLoginUseDifferentAccount"
                    )}
                />
                <LoginPasswordForm
                    identifier={identifier}
                    redirect={redirect}
                    forceLogin={forceLogin}
                />
            </div>
        );
    }

    return (
        <div>
            <UserProfileCard
                identifier={identifier}
                description={t("loginSelectAuthenticationMethod")}
                onUseDifferentAccount={onUseDifferentAccount}
                useDifferentAccountText={t("deviceLoginUseDifferentAccount")}
            />

            {hasInternalAccount && (
                <div className="mt-4">
                    <Button
                        type="button"
                        className="w-full"
                        onClick={() => setShowPasswordForm(true)}
                    >
                        {t("signInWithPassword")}
                    </Button>
                </div>
            )}

            {groupedIdps.length > 0 ? (
                <div className="mt-3 space-y-4">
                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    <div className="relative my-4">
                        <div className="absolute inset-0 flex items-center">
                            <Separator />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="px-2 bg-card text-muted-foreground">
                                {t("idpContinue")}
                            </span>
                        </div>
                    </div>

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
                            groupedIdps.map((group) => {
                                const effectiveType =
                                    group.variant || group.name.toLowerCase();
                                const sourceOrgId = group.orgs[0].orgId;

                                return (
                                    <Button
                                        key={group.idpId}
                                        type="button"
                                        variant="outline"
                                        className="h-auto w-full flex flex-wrap items-center justify-start gap-x-2 gap-y-1.5 py-3 text-left"
                                        onClick={() => {
                                            void loginWithIdp(
                                                group.idpId,
                                                sourceOrgId
                                            );
                                        }}
                                        disabled={pendingIdpId !== null}
                                    >
                                        <IdpTypeIcon
                                            type={effectiveType}
                                            size={16}
                                            className="shrink-0"
                                        />
                                        <span className="font-medium shrink-0">
                                            {group.name}
                                        </span>
                                        {group.orgs.map((org) => (
                                            <Badge
                                                key={org.orgId}
                                                variant="secondary"
                                                className="max-w-full shrink-0 truncate font-normal"
                                            >
                                                {org.orgName}
                                            </Badge>
                                        ))}
                                    </Button>
                                );
                            })
                        )}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
