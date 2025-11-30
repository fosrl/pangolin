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
import { LockIcon, FingerprintIcon } from "lucide-react";
import { createApiClient } from "@app/lib/api";
import {
    InputOTP,
    InputOTPGroup,
    InputOTPSeparator,
    InputOTPSlot
} from "./ui/input-otp";
import Link from "next/link";
import { REGEXP_ONLY_DIGITS_AND_CHARS } from "input-otp";
import Image from "next/image";
import { GenerateOidcUrlResponse } from "@server/routers/idp";
import { Separator } from "./ui/separator";
import { useTranslations } from "next-intl";
import { startAuthentication } from "@simplewebauthn/browser";
import {
    generateOidcUrlProxy,
    loginProxy,
    securityKeyStartProxy,
    securityKeyVerifyProxy
} from "@app/actions/server";
import { redirect as redirectTo } from "next/navigation";
import { useEnvContext } from "@app/hooks/useEnvContext";
// @ts-ignore
import { loadReoScript } from "reodotdev";
import { build } from "@server/build";

export type LoginFormIDP = {
    idpId: number;
    name: string;
    variant?: string;
};

type LoginFormProps = {
    redirect?: string;
    onLogin?: () => void | Promise<void>;
    idps?: LoginFormIDP[];
    orgId?: string;
};

export default function LoginForm({
    redirect,
    onLogin,
    idps,
    orgId
}: LoginFormProps) {
    const router = useRouter();

    const { env } = useEnvContext();
    const api = createApiClient({ env });

    const { resourceGuid } = useParams();

    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const hasIdp = idps && idps.length > 0;

    const [mfaRequested, setMfaRequested] = useState(false);
    const [showSecurityKeyPrompt, setShowSecurityKeyPrompt] = useState(false);

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
            email: "",
            password: ""
        }
    });

    const mfaForm = useForm({
        resolver: zodResolver(mfaSchema),
        defaultValues: {
            code: ""
        }
    });

    async function initiateSecurityKeyAuth() {
        setShowSecurityKeyPrompt(true);
        setLoading(true);
        setError(null);

        try {
            // Start WebAuthn authentication without email
            const startResponse = await securityKeyStartProxy({});

            if (startResponse.error) {
                setError(startResponse.message);
                return;
            }

            const { tempSessionId, ...options } = startResponse.data!;

            // Perform WebAuthn authentication
            try {
                const credential = await startAuthentication({
                    optionsJSON: {
                        ...options,
                        userVerification: options.userVerification as
                            | "required"
                            | "preferred"
                            | "discouraged"
                    }
                });

                // Verify authentication
                const verifyResponse = await securityKeyVerifyProxy(
                    { credential },
                    tempSessionId
                );

                if (verifyResponse.error) {
                    setError(verifyResponse.message);
                    return;
                }

                if (verifyResponse.success) {
                    if (onLogin) {
                        await onLogin();
                    }
                }
            } catch (error: any) {
                if (error.name === "NotAllowedError") {
                    if (error.message.includes("denied permission")) {
                        setError(
                            t("securityKeyPermissionDenied", {
                                defaultValue:
                                    "Please allow access to your security key to continue signing in."
                            })
                        );
                    } else {
                        setError(
                            t("securityKeyRemovedTooQuickly", {
                                defaultValue:
                                    "Please keep your security key connected until the sign-in process completes."
                            })
                        );
                    }
                } else if (error.name === "NotSupportedError") {
                    setError(
                        t("securityKeyNotSupported", {
                            defaultValue:
                                "Your security key may not be compatible. Please try a different security key."
                        })
                    );
                } else {
                    setError(
                        t("securityKeyUnknownError", {
                            defaultValue:
                                "There was a problem using your security key. Please try again."
                        })
                    );
                }
            }
        } catch (e: any) {
            console.error(e);
            setError(
                t("securityKeyAuthError", {
                    defaultValue:
                        "An unexpected error occurred. Please try again."
                })
            );
        } finally {
            setLoading(false);
            setShowSecurityKeyPrompt(false);
        }
    }

    async function onSubmit(values: any) {
        const { email, password } = form.getValues();
        const { code } = mfaForm.getValues();

        setLoading(true);
        setError(null);
        setShowSecurityKeyPrompt(false);

        try {
            const response = await loginProxy({
                email,
                password,
                code,
                resourceGuid: resourceGuid as string
            });

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
                    await onLogin();
                }
                return;
            }

            if (data.useSecurityKey) {
                await initiateSecurityKeyAuth();
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
                await onLogin();
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
        try {
            const data = await generateOidcUrlProxy(
                idpId,
                redirect || "/",
                orgId
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
            {showSecurityKeyPrompt && (
                <Alert>
                    <FingerprintIcon className="w-5 h-5 mr-2" />
                    <AlertDescription>
                        {t("securityKeyPrompt", {
                            defaultValue:
                                "Please verify your identity using your security key. Make sure your security key is connected and ready."
                        })}
                    </AlertDescription>
                </Alert>
            )}

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
                                        href={`${env.app.dashboardUrl}/auth/reset-password${form.getValues().email ? `?email=${form.getValues().email}` : ""}`}
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
                <>
                    <div className="text-center">
                        <h3 className="text-lg font-medium">{t("otpAuth")}</h3>
                        <p className="text-sm text-muted-foreground">
                            {t("otpAuthDescription")}
                        </p>
                    </div>
                    <Form {...mfaForm}>
                        <form
                            onSubmit={mfaForm.handleSubmit(onSubmit)}
                            className="space-y-4"
                            id="form"
                        >
                            <FormField
                                control={mfaForm.control}
                                name="code"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <div className="flex justify-center">
                                                <InputOTP
                                                    maxLength={6}
                                                    {...field}
                                                    pattern={
                                                        REGEXP_ONLY_DIGITS_AND_CHARS
                                                    }
                                                    onChange={(
                                                        value: string
                                                    ) => {
                                                        field.onChange(value);
                                                        if (
                                                            value.length === 6
                                                        ) {
                                                            mfaForm.handleSubmit(
                                                                onSubmit
                                                            )();
                                                        }
                                                    }}
                                                >
                                                    <InputOTPGroup>
                                                        <InputOTPSlot
                                                            index={0}
                                                        />
                                                        <InputOTPSlot
                                                            index={1}
                                                        />
                                                        <InputOTPSlot
                                                            index={2}
                                                        />
                                                        <InputOTPSlot
                                                            index={3}
                                                        />
                                                        <InputOTPSlot
                                                            index={4}
                                                        />
                                                        <InputOTPSlot
                                                            index={5}
                                                        />
                                                    </InputOTPGroup>
                                                </InputOTP>
                                            </div>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </form>
                    </Form>
                </>
            )}

            {error && (
                <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            <div className="space-y-4">
                {mfaRequested && (
                    <Button
                        type="submit"
                        form="form"
                        className="w-full"
                        loading={loading}
                        disabled={loading}
                    >
                        {t("otpAuthSubmit")}
                    </Button>
                )}

                {!mfaRequested && (
                    <>
                        <Button
                            type="button"
                            variant="outline"
                            className="w-full"
                            onClick={initiateSecurityKeyAuth}
                            loading={loading}
                            disabled={loading || showSecurityKeyPrompt}
                        >
                            <FingerprintIcon className="w-4 h-4 mr-2" />
                            {t("securityKeyLogin", {
                                defaultValue: "Sign in with security key"
                            })}
                        </Button>

                        {hasIdp && (
                            <>
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

                                {idps.map((idp) => {
                                    const effectiveType =
                                        idp.variant || idp.name.toLowerCase();

                                    return (
                                        <Button
                                            key={idp.idpId}
                                            type="button"
                                            variant="outline"
                                            className="w-full inline-flex items-center space-x-2"
                                            onClick={() => {
                                                loginWithIdp(idp.idpId);
                                            }}
                                        >
                                            {effectiveType === "google" && (
                                                <Image
                                                    src="/idp/google.png"
                                                    alt="Google"
                                                    width={16}
                                                    height={16}
                                                    className="rounded"
                                                />
                                            )}
                                            {effectiveType === "azure" && (
                                                <Image
                                                    src="/idp/azure.png"
                                                    alt="Azure"
                                                    width={16}
                                                    height={16}
                                                    className="rounded"
                                                />
                                            )}
                                            <span>{idp.name}</span>
                                        </Button>
                                    );
                                })}
                            </>
                        )}
                    </>
                )}

                {mfaRequested && (
                    <Button
                        type="button"
                        className="w-full"
                        variant="outline"
                        onClick={() => {
                            setMfaRequested(false);
                            mfaForm.reset();
                        }}
                    >
                        {t("otpAuthBack")}
                    </Button>
                )}
            </div>
        </div>
    );
}
