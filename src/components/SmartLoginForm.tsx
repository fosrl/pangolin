"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@app/components/ui/button";
import { Input } from "@app/components/ui/input";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { Alert, AlertDescription } from "@app/components/ui/alert";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUserLookup } from "@app/hooks/useUserLookup";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { LookupUserResponse } from "@server/routers/auth/lookupUser";
import { useTranslations } from "next-intl";
import LoginPasswordForm from "@app/components/LoginPasswordForm";
import SmartLoginOrgSelector from "@app/components/SmartLoginOrgSelector";
import UserProfileCard from "@app/components/UserProfileCard";
import SecurityKeyAuthButton from "@app/components/SecurityKeyAuthButton";
import { Separator } from "@app/components/ui/separator";
import OrgSignInLink from "@app/components/OrgSignInLink";
import type { LoginFormIDP } from "./LoginForm";
import IdpLoginButtons from "./IdpLoginButtons";

const identifierSchema = z.object({
    identifier: z.string().min(1, "Username or email is required")
});

// Helper to check if string is a valid email
const isValidEmail = (str: string): boolean => {
    try {
        z.string().email().parse(str);
        return true;
    } catch {
        return false;
    }
};

type OrgSignInConfig = {
    href: string;
    linkText: string;
    descriptionText: string;
};

type SmartLoginFormProps = {
    redirect?: string;
    forceLogin?: boolean;
    defaultUser?: string;
    orgSignIn?: OrgSignInConfig;
    lastUsedIdp?: (LoginFormIDP & { orgId?: string }) | null;
    inviteMode?: boolean;
};

type ViewState =
    | { type: "initial" }
    | {
          type: "password";
          identifier: string;
          account: LookupUserResponse["accounts"][0];
      }
    | {
          type: "orgSelector";
          identifier: string;
          lookupResult: LookupUserResponse;
      };

function buildResetPasswordHref(
    dashboardUrl: string,
    identifier: string,
    redirectParam?: string
) {
    const trimmed = identifier.trim();
    const params = new URLSearchParams();
    if (isValidEmail(trimmed)) {
        params.set("email", trimmed);
    }
    if (redirectParam) {
        params.set("redirect", redirectParam);
    }
    const qs = params.toString();
    return `${dashboardUrl}/auth/reset-password${qs ? `?${qs}` : ""}`;
}

export default function SmartLoginForm({
    redirect,
    forceLogin,
    defaultUser,
    orgSignIn,
    lastUsedIdp,
    inviteMode = false
}: SmartLoginFormProps) {
    const router = useRouter();
    const { env } = useEnvContext();
    const { lookup, loading, error } = useUserLookup();
    const t = useTranslations();
    const [viewState, setViewState] = useState<ViewState>({ type: "initial" });
    const [securityKeyError, setSecurityKeyError] = useState<string | null>(
        null
    );

    const form = useForm<z.infer<typeof identifierSchema>>({
        resolver: zodResolver(identifierSchema),
        defaultValues: {
            identifier: defaultUser ?? ""
        }
    });

    const watchedIdentifier = form.watch("identifier");
    const resetPasswordHref = buildResetPasswordHref(
        env.app.dashboardUrl,
        watchedIdentifier,
        redirect
    );

    const hasAutoLookedUp = useRef(false);
    useEffect(() => {
        if (defaultUser?.trim() && !hasAutoLookedUp.current) {
            hasAutoLookedUp.current = true;
            void handleLookup({ identifier: defaultUser.trim() });
        }
    }, [defaultUser]);

    const handleLookup = async (values: z.infer<typeof identifierSchema>) => {
        const identifier = values.identifier.trim();
        const isEmail = isValidEmail(identifier);
        const result = await lookup(identifier);

        if (!result) {
            // Error already set by hook
            return;
        }

        const signupUrl = redirect
            ? `/auth/signup?email=${encodeURIComponent(identifier)}&redirect=${encodeURIComponent(redirect)}&fromSmartLogin=true`
            : `/auth/signup?email=${encodeURIComponent(identifier)}&fromSmartLogin=true`;

        if (!result.found || result.accounts.length === 0) {
            // No accounts found
            if (!isEmail || forceLogin) {
                // Not a valid email or forceLogin is true - show error
                form.setError("identifier", {
                    type: "manual",
                    message: t("userNotFoundWithUsername")
                });
                return;
            }
            // Valid email but no accounts and not forceLogin - redirect to signup
            router.push(signupUrl);
            return;
        }

        // Invite accept only supports internal (password) accounts
        if (inviteMode) {
            const internalAccount = result.accounts.find(
                (acc) => acc.hasInternalAuth
            );
            if (internalAccount) {
                setViewState({
                    type: "password",
                    identifier,
                    account: internalAccount
                });
                return;
            }

            if (isEmail && !forceLogin) {
                router.push(signupUrl);
                return;
            }

            form.setError("identifier", {
                type: "manual",
                message: t("inviteLoginInternalOnly")
            });
            return;
        }

        // Determine which view to show
        const account = result.accounts[0]; // Use first account for now

        // Check if all accounts are internal-only (no IdPs)
        const allInternalOnly = result.accounts.every(
            (acc) =>
                acc.hasInternalAuth &&
                acc.orgs.every((org) => org.idps.length === 0)
        );

        if (allInternalOnly) {
            // Show password form
            setViewState({
                type: "password",
                identifier,
                account
            });
            return;
        }

        // Show org selector for both single and multiple orgs
        setViewState({
            type: "orgSelector",
            identifier,
            lookupResult: result
        });
    };

    const handleBack = () => {
        setViewState({ type: "initial" });
        form.reset();
    };

    if (viewState.type === "password") {
        return (
            <div className="space-y-4">
                <UserProfileCard
                    identifier={viewState.identifier}
                    description={t("loginSelectAuthenticationMethod")}
                    onUseDifferentAccount={handleBack}
                    useDifferentAccountText={t(
                        "deviceLoginUseDifferentAccount"
                    )}
                />
                <LoginPasswordForm
                    identifier={viewState.identifier}
                    redirect={redirect}
                    forceLogin={forceLogin}
                />
            </div>
        );
    }

    if (viewState.type === "orgSelector") {
        return (
            <div className="space-y-4">
                <SmartLoginOrgSelector
                    identifier={viewState.identifier}
                    lookupResult={viewState.lookupResult}
                    redirect={redirect}
                    forceLogin={forceLogin}
                    onUseDifferentAccount={handleBack}
                />
            </div>
        );
    }

    // Initial view
    return (
        <div className="space-y-4">
            <Form {...form}>
                <form
                    onSubmit={form.handleSubmit(handleLookup)}
                    className="space-y-4"
                    id="form"
                >
                    <FormField
                        control={form.control}
                        name="identifier"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t("usernameOrEmail")}</FormLabel>
                                <FormControl>
                                    <Input
                                        {...field}
                                        type="text"
                                        autoComplete="username"
                                        disabled={loading}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <div className="text-center">
                        <Link
                            href={resetPasswordHref}
                            className="text-sm text-muted-foreground"
                        >
                            {t("passwordForgot")}
                        </Link>
                    </div>

                    {(error || securityKeyError) && (
                        <Alert variant="destructive">
                            <AlertDescription>
                                {error || securityKeyError}
                            </AlertDescription>
                        </Alert>
                    )}
                </form>
            </Form>

            <div className="space-y-4">
                <Button
                    type="submit"
                    form="form"
                    className="w-full"
                    disabled={loading}
                    loading={loading}
                >
                    {t("continue")}
                </Button>

                <SecurityKeyAuthButton
                    redirect={redirect}
                    forceLogin={forceLogin}
                    onError={setSecurityKeyError}
                    disabled={loading}
                />

                {orgSignIn && (
                    <>
                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <Separator />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="px-2 bg-card text-muted-foreground">
                                    {t("idpContinue")}
                                </span>
                            </div>
                        </div>

                        {lastUsedIdp && (
                            <IdpLoginButtons
                                idps={[lastUsedIdp]}
                                orgId={lastUsedIdp.orgId}
                                passOrgIdToOidcUrl={false}
                                redirect={redirect}
                            />
                        )}

                        <OrgSignInLink
                            href={orgSignIn.href}
                            linkText={orgSignIn.linkText}
                            descriptionText={orgSignIn.descriptionText}
                            primaryActionVariant="button"
                            className="mt-0"
                        />
                    </>
                )}
            </div>
        </div>
    );
}
