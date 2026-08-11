"use client";

import { useState } from "react";
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
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { loginProxy, type LoginResponse } from "@app/actions/server";
import Link from "next/link";
import { useEnvContext } from "@app/hooks/useEnvContext";
import {
    cleanRedirect,
    cleanOAuthRedirectOptions
} from "@app/lib/cleanRedirect";
import MfaInputForm from "@app/components/MfaInputForm";
import { LAST_USED_IDP_COOKIE_NAME } from "@app/lib/consts";
import { setClientCookie } from "@app/lib/setClientCookie";

type LoginPasswordFormProps = {
    identifier: string;
    redirect?: string;
    forceLogin?: boolean;
};

export default function LoginPasswordForm({
    identifier,
    redirect,
    forceLogin
}: LoginPasswordFormProps) {
    const router = useRouter();
    const { env } = useEnvContext();
    const t = useTranslations();
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [mfaRequested, setMfaRequested] = useState(false);
    const cleanRedirectOptions = cleanOAuthRedirectOptions(redirect ?? "");

    // Check if identifier is a valid email
    const isEmail = (() => {
        try {
            z.string().email().parse(identifier);
            return true;
        } catch {
            return false;
        }
    })();

    const currentHost =
        typeof window !== "undefined" ? window.location.hostname : "";
    const expectedHost = new URL(env.app.dashboardUrl).host;
    const isExpectedHost = currentHost === expectedHost;

    const formSchema = z.object({
        password: z.string().min(8, { message: t("passwordRequirementsChars") })
    });

    const mfaSchema = z.object({
        code: z.string().length(6, { message: t("pincodeInvalid") })
    });

    const form = useForm({
        resolver: zodResolver(formSchema),
        defaultValues: {
            password: ""
        }
    });

    const mfaForm = useForm({
        resolver: zodResolver(mfaSchema),
        defaultValues: {
            code: ""
        }
    });

    const redirectAfterLogin = () => {
        if (redirect) {
            const safe = cleanRedirect(redirect, cleanRedirectOptions);
            router.replace(safe);
            return;
        }

        router.replace("/");
    };

    const handleSetupRequirements = (data: LoginResponse): boolean => {
        if (data.emailVerificationRequired) {
            if (!isExpectedHost) {
                setError(
                    t("emailVerificationRequired", {
                        dashboardUrl: env.app.dashboardUrl
                    })
                );
                return true;
            }

            if (redirect) {
                router.push(`/auth/verify-email?redirect=${redirect}`);
            } else {
                router.push("/auth/verify-email");
            }

            return true;
        }

        if (data.twoFactorSetupRequired) {
            if (!isExpectedHost) {
                setError(
                    t("twoFactorSetupRequired", {
                        dashboardUrl: env.app.dashboardUrl
                    })
                );
                return true;
            }

            const setupUrl = `/auth/2fa/setup?email=${encodeURIComponent(identifier)}${redirect ? `&redirect=${encodeURIComponent(redirect)}` : ""}`;
            router.push(setupUrl);
            return true;
        }

        return false;
    };

    const submitLogin = async (password: string, code?: string) => {
        return loginProxy(
            {
                email: identifier,
                password,
                code,
                resourceGuid: undefined
            },
            forceLogin
        );
    };

    async function onSubmit(values: z.infer<typeof formSchema>) {
        const { password } = values;
        const { code } = mfaForm.getValues();

        // delete last used auth cookie by setting it in the past
        setClientCookie(LAST_USED_IDP_COOKIE_NAME, JSON.stringify(null), {
            sameSite: "Lax",
            days: -1
        });

        setLoading(true);
        setError(null);

        try {
            const response = await submitLogin(password, code);

            if (response.error) {
                setError(response.message);
                return;
            }

            const data = response.data;

            if (!data) {
                redirectAfterLogin();
                return;
            }

            if (data.useSecurityKey) {
                setError(t("securityKeyRequired"));
                return;
            }

            if (data.codeRequested) {
                setMfaRequested(true);
                mfaForm.reset();
                return;
            }

            if (handleSetupRequirements(data)) {
                return;
            }

            redirectAfterLogin();
        } catch (e: unknown) {
            console.error(e);
            setError(t("loginError"));
        } finally {
            setLoading(false);
        }
    }

    async function onMfaSubmit(values: z.infer<typeof mfaSchema>) {
        const { password } = form.getValues();
        const { code } = values;

        setLoading(true);
        setError(null);

        try {
            const response = await submitLogin(password, code);

            if (response.error) {
                setError(response.message);
                return;
            }

            const data = response.data;

            if (!data) {
                redirectAfterLogin();
                return;
            }

            if (data.useSecurityKey) {
                setError(t("securityKeyRequired"));
                return;
            }

            if (data.codeRequested) {
                mfaForm.reset();
                setMfaRequested(true);
                return;
            }

            if (handleSetupRequirements(data)) {
                return;
            }

            redirectAfterLogin();
        } catch (e: unknown) {
            console.error(e);
            setError(t("loginError"));
        } finally {
            setLoading(false);
        }
    }

    if (mfaRequested) {
        return (
            <MfaInputForm
                form={mfaForm}
                onSubmit={onMfaSubmit}
                onBack={() => {
                    setMfaRequested(false);
                    mfaForm.reset();
                }}
                error={error}
                loading={loading}
                username={identifier}
            />
        );
    }

    return (
        <div className="space-y-4">
            <Form {...form}>
                <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="space-y-4"
                >
                    <FormField
                        control={form.control}
                        name="password"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t("password")}</FormLabel>
                                <FormControl>
                                    <Input
                                        {...field}
                                        type="password"
                                        autoComplete="current-password"
                                        autoFocus
                                        disabled={loading}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    <div className="text-center">
                        <Link
                            href={`${env.app.dashboardUrl}/auth/reset-password${isEmail ? `?email=${encodeURIComponent(identifier)}` : ""}${redirect ? `${isEmail ? "&" : "?"}redirect=${encodeURIComponent(redirect)}` : ""}`}
                            className="text-sm text-muted-foreground"
                        >
                            {t("passwordForgot")}
                        </Link>
                    </div>

                    <Button
                        type="submit"
                        className="w-full"
                        disabled={loading}
                        loading={loading}
                    >
                        {t("logIn")}
                    </Button>
                </form>
            </Form>
        </div>
    );
}
