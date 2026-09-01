"use client";

import { useEffect, useState } from "react";
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
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from "@app/components/ui/card";
import { Alert, AlertDescription } from "@app/components/ui/alert";
import { useParams, useRouter } from "next/navigation";
import { LockIcon } from "lucide-react";
import SecurityKeyAuthButton from "@app/components/SecurityKeyAuthButton";
import { createApiClient } from "@app/lib/api";
import Link from "next/link";
import { GenerateOidcUrlResponse } from "@server/routers/idp";
import { Separator } from "./ui/separator";
import { useTranslations } from "next-intl";
import { generateOidcUrlProxy, loginProxy } from "@app/actions/server";
import { redirect as redirectTo } from "next/navigation";
import { useEnvContext } from "@app/hooks/useEnvContext";
import IdpTypeIcon from "@app/components/IdpTypeIcon";
// @ts-ignore
import { loadReoScript } from "reodotdev";
import { build } from "@server/build";
import MfaInputForm from "@app/components/MfaInputForm";
import { useLocalStorage } from "@app/hooks/useLocalStorage";

export type LoginFormIDP = {
    idpId: number;
    name: string;
    variant?: string;
    lastUsed?: boolean;
};

type LoginFormProps = {
    redirect?: string;
    onLogin?: (redirectUrl?: string) => void | Promise<void>;
    idps?: LoginFormIDP[];
    orgId?: string;
    forceLogin?: boolean;
    defaultEmail?: string;
};

export default function LoginForm({
    redirect,
    onLogin,
    idps,
    orgId,
    forceLogin,
    defaultEmail
}: LoginFormProps) {
    const router = useRouter();

    const { env } = useEnvContext();
    const api = createApiClient({ env });

    const { resourceGuid } = useParams();

    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const hasIdp = idps && idps.length > 0;

    const [mfaRequested, setMfaRequested] = useState(false);

    const t = useTranslations();
    const currentHost =
        typeof window !== "undefined" ? window.location.hostname : "";
    const expectedHost = new URL(env.app.dashboardUrl).host;
    const isExpectedHost = currentHost === expectedHost;

    const [reo, setReo] = useState<any | undefined>(undefined);
    useEffect(() => {
        async function init() {
            if (env.app.environment !== "prod") {
                return;
            }
            try {
                const clientID = env.server.reoClientId;
                const reoClient = await loadReoScript({ clientID });
                await reoClient.init({ clientID });
                setReo(reoClient);
            } catch (e) {
                console.error("Failed to load Reo script", e);
            }
        }

        if (build == "saas") {
            init();
        }
    }, []);

    const formSchema = z.object({
        email: z.string().email({ message: t("emailInvalid") }),
        password: z.string().min(8, { message: t("passwordRequirementsChars") })
    });

    const mfaSchema = z.object({
        code: z.string().length(6, { message: t("pincodeInvalid") })
    });

    const form = useForm({
        resolver: zodResolver(formSchema),
        defaultValues: {
            email: defaultEmail ?? "",
            password: ""
        }
    });

    const mfaForm = useForm({
        resolver: zodResolver(mfaSchema),
        defaultValues: {
            code: ""
        }
    });

    const [lastUsedIdpId, setLastUsedIdpId] = useLocalStorage<string | null>(
        "login:last-used-idp",
        null
    );

    async function onSubmit(values: any) {
        const { email, password } = form.getValues();
        const { code } = mfaForm.getValues();

        setLastUsedIdpId(null);
        setLoading(true);
        setError(null);

        try {
            const response = await loginProxy(
                {
                    email,
                    password,
                    code,
                    resourceGuid: resourceGuid as string
                },
                forceLogin
            );

            try {
                const identity = {
                    username: email,
                    type: "email" // can be one of email, github, linkedin, gmail, userID,
                };
                if (reo) {
                    reo.identify(identity);
                }
            } catch (e) {
                console.error("Reo identify error:", e);
            }

            if (response.error) {
                setError(response.message);
                return;
            }

            const data = response.data;

            // Handle case where data is null (e.g., already logged in)
            if (!data) {
                if (onLogin) {
                    await onLogin(redirect);
                }
                return;
            }

            if (data.useSecurityKey) {
                setError(
                    t("securityKeyRequired", {
                        defaultValue: "Please use your security key to sign in."
                    })
                );
                return;
            }

            if (data.codeRequested) {
                setMfaRequested(true);
                setLoading(false);
                mfaForm.reset();
                return;
            }

            if (data.emailVerificationRequired) {
                if (!isExpectedHost) {
                    setError(
                        t("emailVerificationRequired", {
                            dashboardUrl: env.app.dashboardUrl
                        })
                    );
                    return;
                }
                if (redirect) {
                    router.push(`/auth/verify-email?redirect=${redirect}`);
                } else {
                    router.push("/auth/verify-email");
                }
                return;
            }

            if (data.twoFactorSetupRequired) {
                if (!isExpectedHost) {
                    setError(
                        t("twoFactorSetupRequired", {
                            dashboardUrl: env.app.dashboardUrl
                        })
                    );
                    return;
                }
                const setupUrl = `/auth/2fa/setup?email=${encodeURIComponent(email)}${redirect ? `&redirect=${encodeURIComponent(redirect)}` : ""}`;
                router.push(setupUrl);
                return;
            }

            if (onLogin) {
                await onLogin(redirect);
            }
        } catch (e: any) {
            console.error(e);
            setError(
                t("loginError", {
                    defaultValue:
                        "An unexpected error occurred. Please try again."
                })
            );
        } finally {
            setLoading(false);
        }
    }

    async function loginWithIdp(idpId: number) {
        let redirectUrl: string | undefined;

        setLastUsedIdpId(idpId.toString());
        try {
            const data = await generateOidcUrlProxy(
                idpId,
                redirect || "/",
                orgId,
                forceLogin
            );
            const url = data.data?.redirectUrl;
            if (data.error) {
                setError(data.message);
                return;
            }
            if (url) {
                redirectUrl = url;
            }
        } catch (e: any) {
            setError(e.message || t("loginError"));
            console.error(e);
        }
        if (redirectUrl) {
            redirectTo(redirectUrl);
        }
    }

    return (
        <div className="space-y-4">
            {!mfaRequested && (
                <>
                    <Form {...form}>
                        <form
                            onSubmit={form.handleSubmit(onSubmit)}
                            className="space-y-4"
                            id="form"
                        >
                            <FormField
                                control={form.control}
                                name="email"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t("email")}</FormLabel>
                                        <FormControl>
                                            <Input {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <div className="space-y-4">
                                <FormField
                                    control={form.control}
                                    name="password"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>
                                                {t("password")}
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="password"
                                                    {...field}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <div className="text-center">
                                    <Link
                                        href={`${env.app.dashboardUrl}/auth/reset-password${form.getValues().email ? `?email=${encodeURIComponent(form.getValues().email)}` : ""}`}
                                        className="text-sm text-muted-foreground"
                                    >
                                        {t("passwordForgot")}
                                    </Link>
                                </div>
                            </div>

                            <div className="flex flex-col space-y-2">
                                <Button
                                    type="submit"
                                    disabled={loading}
                                    loading={loading}
                                >
                                    {t("login")}
                                </Button>
                            </div>
                        </form>
                    </Form>
                </>
            )}

            {mfaRequested && (
                <MfaInputForm
                    form={mfaForm}
                    onSubmit={onSubmit}
                    onBack={() => {
                        setMfaRequested(false);
                        mfaForm.reset();
                    }}
                    error={error}
                    loading={loading}
                    formId="form"
                    username={form.getValues("email")}
                />
            )}

            {!mfaRequested && error && (
                <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            <div className="space-y-4">
                {!mfaRequested && (
                    <>
                        <SecurityKeyAuthButton
                            redirect={redirect}
                            forceLogin={forceLogin}
                            onSuccess={onLogin}
                            onError={setError}
                            disabled={loading}
                        />

                        {hasIdp && (
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

                                {idps.map((idp) => {
                                    const effectiveType =
                                        idp.variant || idp.name.toLowerCase();

                                    return (
                                        <div
                                            className="w-full relative"
                                            key={idp.idpId}
                                        >
                                            <Button
                                                key={idp.idpId}
                                                type="button"
                                                variant="outline"
                                                className="w-full inline-flex items-center space-x-2 after:absolute after:inset-0 after:z-10"
                                                onClick={() => {
                                                    loginWithIdp(idp.idpId);
                                                }}
                                            >
                                                <IdpTypeIcon
                                                    type={effectiveType}
                                                    size={16}
                                                />
                                                <span>{idp.name}</span>
                                            </Button>

                                            {lastUsedIdpId ===
                                                idp.idpId.toString() && (
                                                <div className="absolute inset-0">
                                                    <span className="absolute top-0 right-0 text-xs bg-primary text-primary-foreground rounded-bl-sm rounded-tr-sm px-2 py-0.5">
                                                        {t("idpLastUsed")}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
