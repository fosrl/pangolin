"use client";

import { useState, useEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@/components/ui/form";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useRouter } from "next/navigation";
import {
    InputOTP,
    InputOTPGroup,
    InputOTPSeparator,
    InputOTPSlot
} from "@/components/ui/input-otp";
import { REGEXP_ONLY_DIGITS_AND_CHARS } from "input-otp";
import { AlertTriangle, Loader2 } from "lucide-react";
import { DeviceAuthConfirmation } from "@/components/DeviceAuthConfirmation";
import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";
import BrandingLogo from "./BrandingLogo";
import { useTranslations } from "next-intl";
import UserProfileCard from "@/components/UserProfileCard";

const createFormSchema = (t: (key: string) => string) =>
    z.object({
        code: z.string().length(8, t("deviceCodeInvalidFormat"))
    });

type DeviceAuthMetadata = {
    ip: string | null;
    city: string | null;
    deviceName: string | null;
    applicationName: string;
    createdAt: number;
};

type DeviceLoginFormProps = {
    userEmail: string;
    userName?: string;
    initialCode?: string;
    userQueryParam?: string;
};

export default function DeviceLoginForm({
    userEmail,
    userName,
    initialCode = "",
    userQueryParam
}: DeviceLoginFormProps) {
    const router = useRouter();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [validatingInitialCode, setValidatingInitialCode] = useState(false);
    const [verifyingInitialCode, setVerifyingInitialCode] = useState(false);
    const [metadata, setMetadata] = useState<DeviceAuthMetadata | null>(null);
    const [code, setCode] = useState<string>("");
    const { isUnlocked } = useLicenseStatusContext();
    const t = useTranslations();

    const formSchema = createFormSchema(t);

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            code: initialCode.replace(/-/g, "").toUpperCase()
        }
    });

    const validateCode = useCallback(
        async (codeToValidate: string, skipConfirmation = false) => {
            setError(null);
            setLoading(true);

            try {
                // split code and add dash if missing
                let formattedCode = codeToValidate;
                if (
                    !formattedCode.includes("-") &&
                    formattedCode.length === 8
                ) {
                    formattedCode =
                        formattedCode.slice(0, 4) +
                        "-" +
                        formattedCode.slice(4);
                }

                // First check - get metadata
                const res = await api.post(
                    "/device-web-auth/verify?forceLogin=true",
                    {
                        code: formattedCode.toUpperCase(),
                        verify: false
                    }
                );

                if (res.data.success && res.data.data.metadata) {
                    setCode(formattedCode.toUpperCase());

                    // If skipping confirmation (initial code), go straight to verify
                    if (skipConfirmation) {
                        setVerifyingInitialCode(true);
                        try {
                            await api.post("/device-web-auth/verify", {
                                code: formattedCode.toUpperCase(),
                                verify: true
                            });
                            router.push("/auth/login/device/success");
                        } catch (e: any) {
                            const errorMessage = formatAxiosError(e);
                            setError(
                                errorMessage || t("deviceCodeVerifyFailed")
                            );
                            setVerifyingInitialCode(false);
                            return false;
                        }
                        return true;
                    } else {
                        setMetadata(res.data.data.metadata);
                        return true;
                    }
                } else {
                    setError(t("deviceCodeInvalidOrExpired"));
                    return false;
                }
            } catch (e: any) {
                const errorMessage = formatAxiosError(e);
                setError(errorMessage || t("deviceCodeInvalidOrExpired"));
                return false;
            } finally {
                setLoading(false);
            }
        },
        [api, t, router]
    );

    async function onSubmit(data: z.infer<typeof formSchema>) {
        await validateCode(data.code);
    }

    // Auto-validate initial code if provided
    useEffect(() => {
        const cleanedInitialCode = initialCode.replace(/-/g, "").toUpperCase();
        if (cleanedInitialCode && cleanedInitialCode.length === 8) {
            setValidatingInitialCode(true);
            validateCode(cleanedInitialCode, false).finally(() => {
                setValidatingInitialCode(false);
            });
        }
    }, [initialCode, validateCode]);

    async function onConfirm() {
        if (!code || !metadata) return;

        setError(null);
        setLoading(true);

        try {
            // Final verify
            await api.post("/device-web-auth/verify", {
                code: code,
                verify: true
            });

            // Redirect to success page
            router.push("/auth/login/device/success");
        } catch (e: any) {
            const errorMessage = formatAxiosError(e);
            setError(errorMessage || t("deviceCodeVerifyFailed"));
            setMetadata(null);
            setCode("");
            form.reset();
        } finally {
            setLoading(false);
        }
    }

    const logoWidth = isUnlocked()
        ? env.branding.logo?.authPage?.width || 175
        : 175;
    const logoHeight = isUnlocked()
        ? env.branding.logo?.authPage?.height || 44
        : 44;

    function onCancel() {
        setMetadata(null);
        setCode("");
        form.reset();
        setError(null);
    }

    const profileLabel = (userName || userEmail || "").trim();

    async function handleUseDifferentAccount() {
        try {
            await api.post("/auth/logout");
        } catch (logoutError) {
            console.error(
                "Failed to logout before switching account",
                logoutError
            );
        } finally {
            const currentSearch =
                typeof window !== "undefined" ? window.location.search : "";
            const redirectTarget = `/auth/login/device${currentSearch || ""}`;
            const loginUrl = new URL("/auth/login", "http://x");
            loginUrl.searchParams.set("forceLogin", "true");
            loginUrl.searchParams.set("redirect", redirectTarget);
            if (userQueryParam)
                loginUrl.searchParams.set("user", userQueryParam);
            router.push(loginUrl.pathname + loginUrl.search);
            router.refresh();
        }
    }

    // Show loading state while validating/verifying initial code
    if (validatingInitialCode || verifyingInitialCode) {
        return (
            <div className="flex items-center justify-center">
                <Card className="w-full max-w-md">
                    <CardHeader>
                        <CardTitle>{t("deviceActivation")}</CardTitle>
                        <CardDescription>
                            {validatingInitialCode
                                ? t("deviceCodeValidating")
                                : t("deviceCodeVerifying")}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col items-center space-y-4">
                        <div className="flex items-center space-x-2">
                            <Loader2 className="h-5 w-5 animate-spin" />
                            <span>
                                {validatingInitialCode
                                    ? t("deviceCodeValidating")
                                    : t("deviceCodeVerifying")}
                            </span>
                        </div>
                        {error && (
                            <Alert variant="destructive" className="w-full">
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
                        )}
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (metadata) {
        return (
            <DeviceAuthConfirmation
                metadata={metadata}
                onConfirm={onConfirm}
                onCancel={onCancel}
                loading={loading}
            />
        );
    }

    return (
        <Card className="w-full max-w-md">
            <CardHeader className="border-b">
                <div className="flex flex-row items-center justify-center">
                    <BrandingLogo height={logoHeight} width={logoWidth} />
                </div>
                <div className="text-center space-y-1 pt-3">
                    <p className="text-muted-foreground">
                        {t("deviceActivation")}
                    </p>
                </div>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
                <UserProfileCard
                    identifier={profileLabel || userEmail}
                    description={t(
                        "deviceLoginDeviceRequestingAccessToAccount"
                    )}
                    onUseDifferentAccount={handleUseDifferentAccount}
                    useDifferentAccountText={t(
                        "deviceLoginUseDifferentAccount"
                    )}
                />

                <Form {...form}>
                    <form
                        onSubmit={form.handleSubmit(onSubmit)}
                        className="space-y-4"
                    >
                        <div className="space-y-2">
                            <p className="text-sm text-muted-foreground text-center">
                                {t("deviceCodeEnterPrompt")}
                            </p>
                        </div>

                        <FormField
                            control={form.control}
                            name="code"
                            render={({ field }) => (
                                <FormItem>
                                    <FormControl>
                                        <div className="flex justify-center">
                                            <InputOTP
                                                maxLength={9}
                                                pattern={REGEXP_ONLY_DIGITS_AND_CHARS}
                                                {...field}
                                                value={field.value
                                                    .replace(/-/g, "")
                                                    .toUpperCase()}
                                                onChange={(value) => {
                                                    // Strip hyphens and convert to uppercase
                                                    const cleanedValue = value
                                                        .replace(/-/g, "")
                                                        .toUpperCase();
                                                    field.onChange(
                                                        cleanedValue
                                                    );
                                                }}
                                            >
                                                <InputOTPGroup>
                                                    <InputOTPSlot index={0} />
                                                    <InputOTPSlot index={1} />
                                                    <InputOTPSlot index={2} />
                                                    <InputOTPSlot index={3} />
                                                </InputOTPGroup>
                                                <InputOTPSeparator />
                                                <InputOTPGroup>
                                                    <InputOTPSlot index={4} />
                                                    <InputOTPSlot index={5} />
                                                    <InputOTPSlot index={6} />
                                                    <InputOTPSlot index={7} />
                                                </InputOTPGroup>
                                            </InputOTP>
                                        </div>
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

                        <Button
                            type="submit"
                            className="w-full"
                            disabled={loading}
                            loading={loading}
                        >
                            {t("continue")}
                        </Button>
                    </form>
                </Form>
            </CardContent>
        </Card>
    );
}
