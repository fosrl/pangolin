"use client";

import { useState } from "react";
import { Button } from "@app/components/ui/button";
import { useTranslations } from "next-intl";
import LoginPasswordForm from "./LoginPasswordForm";
import IdpLoginButtons from "./IdpLoginButtons";
import { LookupUserResponse } from "@server/routers/auth/lookupUser";
import UserProfileCard from "./UserProfileCard";
import { useEnvContext } from "@app/hooks/useEnvContext";

type LoginOrgSelectorProps = {
    identifier: string;
    lookupResult: LookupUserResponse;
    redirect?: string;
    forceLogin?: boolean;
    onUseDifferentAccount?: () => void;
};

export default function LoginOrgSelector({
    identifier,
    lookupResult,
    redirect,
    forceLogin,
    onUseDifferentAccount
}: LoginOrgSelectorProps) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const hideOrgNames = env.flags.disableLoginOrgNames;
    const [showPasswordForm, setShowPasswordForm] = useState(false);

    // Collect all unique orgs from all accounts
    const orgMap = new Map<
        string,
        {
            orgId: string;
            orgName: string;
            idps: Array<{
                idpId: number;
                name: string;
                variant: string | null;
            }>;
            hasInternalAuth: boolean;
        }
    >();

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
                // Merge IdPs if org appears in multiple accounts
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

    const orgs = Array.from(orgMap.values());

    // With org names hidden, show one flat list of IdPs with no org headings
    const allIdps = hideOrgNames
        ? Array.from(
              new Map(
                  orgs.flatMap((org) =>
                      org.idps.map((idp) => [idp.idpId, idp] as const)
                  )
              ).values()
          ).map((idp) => ({
              idpId: idp.idpId,
              name: idp.name,
              variant: idp.variant || undefined
          }))
        : [];

    // Check if there's an internal account (can only be one)
    const hasInternalAccount = lookupResult.accounts.some(
        (acc) => acc.hasInternalAuth
    );

    // If user selected password auth, show password form
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
                <div className="mt-3">
                    <Button
                        type="button"
                        className="w-full"
                        onClick={() => setShowPasswordForm(true)}
                    >
                        {t("signInWithPassword")}
                    </Button>
                </div>
            )}

            {hideOrgNames ? (
                <div className="py-3 mt-3">
                    <IdpLoginButtons idps={allIdps} redirect={redirect} />
                </div>
            ) : (
                <div className="space-y-0 mt-3">
                    {orgs.map((org, index) => {
                        const hasIdps = org.idps.length > 0;

                        if (!hasIdps) {
                            return null;
                        }

                        // Convert org.idps to LoginFormIDP format
                        const idps = org.idps.map((idp) => ({
                            idpId: idp.idpId,
                            name: idp.name,
                            variant: idp.variant || undefined
                        }));

                        return (
                            <div key={org.orgId}>
                                <div className="py-3">
                                    <h3 className="text-base font-semibold mb-3">
                                        {org.orgName}
                                    </h3>
                                    <IdpLoginButtons
                                        idps={idps}
                                        redirect={redirect}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
