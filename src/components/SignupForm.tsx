"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { SignUpResponse } from "@server/routers/auth";
import { useRouter } from "next/navigation";
import { passwordSchema } from "@server/auth/passwordSchema";
import { AxiosResponse } from "axios";
import { formatAxiosError } from "@app/lib/api";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { cleanRedirect } from "@app/lib/cleanRedirect";
import { useTranslations } from "next-intl";
import BrandingLogo from "@app/components/BrandingLogo";
import { build } from "@server/build";
import { Check, X } from "lucide-react";
import { cn } from "@app/lib/cn";
import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";

// Password strength calculation
const calculatePasswordStrength = (password: string) => {
    const requirements = {
        length: password.length >= 8,
        uppercase: /[A-Z]/.test(password),
        lowercase: /[a-z]/.test(password),
        number: /[0-9]/.test(password),
        special: /[~!`@#$%^&*()_\-+={}[\]|\\:;"'<>,.\/?]/.test(password)
    };

    const score = Object.values(requirements).filter(Boolean).length;
    let strength: "weak" | "medium" | "strong" = "weak";
    let color = "bg-red-500";
    let percentage = 0;

    if (score >= 5) {
        strength = "strong";
        color = "bg-green-500";
        percentage = 100;
    } else if (score >= 3) {
        strength = "medium";
        color = "bg-yellow-500";
        percentage = 60;
    } else if (score >= 1) {
        strength = "weak";
        color = "bg-red-500";
        percentage = 30;
    }

    return { requirements, strength, color, percentage, score };
};

type SignupFormProps = {
    redirect?: string;
    inviteId?: string;
    inviteToken?: string;
    emailParam?: string;
};

const formSchema = z
    .object({
        email: z.string().email({ message: "Invalid email address" }),
        password: passwordSchema,
        confirmPassword: passwordSchema,
        agreeToTerms: z.boolean().refine(
            (val) => {
                if (build === "saas") {
                    val === true;
                }
                return true;
            },
            {
                message:
                    "You must agree to the terms of service and privacy policy"
            }
        ),
        marketingEmailConsent: z.boolean().optional()
    })
    .refine((data) => data.password === data.confirmPassword, {
        path: ["confirmPassword"],
        message: "Passwords do not match"
    });

export default function SignupForm({
    redirect,
    inviteId,
    inviteToken,
    emailParam
}: SignupFormProps) {
    const router = useRouter();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const t = useTranslations();
    const { isUnlocked } = useLicenseStatusContext();

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [termsAgreedAt, setTermsAgreedAt] = useState<string | null>(null);
    const [passwordValue, setPasswordValue] = useState("");
    const [confirmPasswordValue, setConfirmPasswordValue] = useState("");

    const form = useForm({
        resolver: zodResolver(formSchema),
        defaultValues: {
            email: emailParam || "",
            password: "",
            confirmPassword: "",
            agreeToTerms: false,
            marketingEmailConsent: false
        },
        mode: "onChange" // Enable real-time validation
    });

    const passwordStrength = calculatePasswordStrength(passwordValue);
    const doPasswordsMatch =
        passwordValue.length > 0 &&
        confirmPasswordValue.length > 0 &&
        passwordValue === confirmPasswordValue;

    async function onSubmit(values: z.infer<typeof formSchema>) {
        const { email, password, marketingEmailConsent } = values;

        setLoading(true);
        const res = await api
            .put<AxiosResponse<SignUpResponse>>("/auth/signup", {
                email,
                password,
                inviteId,
                inviteToken,
                termsAcceptedTimestamp: termsAgreedAt,
                marketingEmailConsent: build === "saas" ? marketingEmailConsent : undefined
            })
            .catch((e) => {
                console.error(e);
                setError(formatAxiosError(e, t("signupError")));
            });

        if (res && res.status === 200) {
            setError(null);

            if (res.data?.data?.emailVerificationRequired) {
                if (redirect) {
                    const safe = cleanRedirect(redirect);
                    router.push(`/auth/verify-email?redirect=${safe}`);
                } else {
                    router.push("/auth/verify-email");
                }
                return;
            }

            if (redirect) {
                const safe = cleanRedirect(redirect);
                router.push(safe);
            } else {
                router.push("/");
            }
        }

        setLoading(false);
    }

    function getSubtitle() {
        return t("authCreateAccount");
    }

    const handleTermsChange = (checked: boolean) => {
        if (checked) {
            const isoNow = new Date().toISOString();
            console.log("Terms agreed at:", isoNow);
            setTermsAgreedAt(isoNow);
            form.setValue("agreeToTerms", true);
        } else {
            form.setValue("agreeToTerms", false);
            setTermsAgreedAt(null);
        }
    };

    const logoWidth = isUnlocked()
        ? env.branding.logo?.authPage?.width || 175
        : 175;
    const logoHeight = isUnlocked()
        ? env.branding.logo?.authPage?.height || 58
        : 58;

    return (
        <Card className="w-full max-w-md shadow-md">
            <CardHeader className="border-b">
                <div className="flex flex-row items-center justify-center">
                    <BrandingLogo height={logoHeight} width={logoWidth} />
                </div>
                <div className="text-center space-y-1 pt-3">
                    <p className="text-muted-foreground">{getSubtitle()}</p>
                </div>
            </CardHeader>
            <CardContent className="pt-6">
                <Form {...form}>
                    <form
                        onSubmit={form.handleSubmit(onSubmit)}
                        className="space-y-4"
                    >
                        <FormField
                            control={form.control}
                            name="email"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t("email")}</FormLabel>
                                    <FormControl>
                                        <Input
                                            {...field}
                                            disabled={!!emailParam}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="password"
                            render={({ field }) => (
                                <FormItem>
                                    <div className="flex items-center gap-2">
                                        <FormLabel>{t("password")}</FormLabel>
                                        {passwordStrength.strength ===
                                            "strong" && (
                                            <Check className="h-4 w-4 text-green-500" />
                                        )}
                                    </div>
                                    <FormControl>
                                        <div className="relative">
                                            <Input
                                                type="password"
                                                {...field}
                                                onChange={(e) => {
                                                    field.onChange(e);
                                                    setPasswordValue(
                                                        e.target.value
                                                    );
                                                }}
                                                className={cn(
                                                    passwordStrength.strength ===
                                                        "strong" &&
                                                        "border-green-500 focus-visible:ring-green-500",
                                                    passwordStrength.strength ===
                                                        "medium" &&
                                                        "border-yellow-500 focus-visible:ring-yellow-500",
                                                    passwordStrength.strength ===
                                                        "weak" &&
                                                        passwordValue.length >
                                                            0 &&
                                                        "border-red-500 focus-visible:ring-red-500"
                                                )}
                                                autoComplete="new-password"
                                            />
                                        </div>
                                    </FormControl>

                                    {passwordValue.length > 0 && (
                                        <div className="space-y-3 mt-2">
                                            {/* Password Strength Meter */}
                                            <div className="space-y-2">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-sm font-medium text-foreground">
                                                        {t("passwordStrength")}
                                                    </span>
                                                    <span
                                                        className={cn(
                                                            "text-sm font-semibold",
                                                            passwordStrength.strength ===
                                                                "strong" &&
                                                                "text-green-600 dark:text-green-400",
                                                            passwordStrength.strength ===
                                                                "medium" &&
                                                                "text-yellow-600 dark:text-yellow-400",
                                                            passwordStrength.strength ===
                                                                "weak" &&
                                                                "text-red-600 dark:text-red-400"
                                                        )}
                                                    >
                                                        {t(
                                                            `passwordStrength${passwordStrength.strength.charAt(0).toUpperCase() + passwordStrength.strength.slice(1)}`
                                                        )}
                                                    </span>
                                                </div>
                                                <Progress
                                                    value={
                                                        passwordStrength.percentage
                                                    }
                                                    className="h-2"
                                                />
                                            </div>

                                            {/* Requirements Checklist */}
                                            <div className="bg-muted rounded-lg p-3 space-y-2">
                                                <div className="text-sm font-medium text-foreground mb-2">
                                                    {t("passwordRequirements")}
                                                </div>
                                                <div className="grid grid-cols-1 gap-1.5">
                                                    <div className="flex items-center gap-2">
                                                        {passwordStrength
                                                            .requirements
                                                            .length ? (
                                                            <Check className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                                                        ) : (
                                                            <X className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                                        )}
                                                        <span
                                                            className={cn(
                                                                "text-sm",
                                                                passwordStrength
                                                                    .requirements
                                                                    .length
                                                                    ? "text-green-600 dark:text-green-400"
                                                                    : "text-muted-foreground"
                                                            )}
                                                        >
                                                            {t(
                                                                "passwordRequirementLengthText"
                                                            )}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {passwordStrength
                                                            .requirements
                                                            .uppercase ? (
                                                            <Check className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                                                        ) : (
                                                            <X className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                                        )}
                                                        <span
                                                            className={cn(
                                                                "text-sm",
                                                                passwordStrength
                                                                    .requirements
                                                                    .uppercase
                                                                    ? "text-green-600 dark:text-green-400"
                                                                    : "text-muted-foreground"
                                                            )}
                                                        >
                                                            {t(
                                                                "passwordRequirementUppercaseText"
                                                            )}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {passwordStrength
                                                            .requirements
                                                            .lowercase ? (
                                                            <Check className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                                                        ) : (
                                                            <X className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                                        )}
                                                        <span
                                                            className={cn(
                                                                "text-sm",
                                                                passwordStrength
                                                                    .requirements
                                                                    .lowercase
                                                                    ? "text-green-600 dark:text-green-400"
                                                                    : "text-muted-foreground"
                                                            )}
                                                        >
                                                            {t(
                                                                "passwordRequirementLowercaseText"
                                                            )}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {passwordStrength
                                                            .requirements
                                                            .number ? (
                                                            <Check className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                                                        ) : (
                                                            <X className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                                        )}
                                                        <span
                                                            className={cn(
                                                                "text-sm",
                                                                passwordStrength
                                                                    .requirements
                                                                    .number
                                                                    ? "text-green-600 dark:text-green-400"
                                                                    : "text-muted-foreground"
                                                            )}
                                                        >
                                                            {t(
                                                                "passwordRequirementNumberText"
                                                            )}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {passwordStrength
                                                            .requirements
                                                            .special ? (
                                                            <Check className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                                                        ) : (
                                                            <X className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                                        )}
                                                        <span
                                                            className={cn(
                                                                "text-sm",
                                                                passwordStrength
                                                                    .requirements
                                                                    .special
                                                                    ? "text-green-600 dark:text-green-400"
                                                                    : "text-muted-foreground"
                                                            )}
                                                        >
                                                            {t(
                                                                "passwordRequirementSpecialText"
                                                            )}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Only show FormMessage when not showing our custom requirements */}
                                    {passwordValue.length === 0 && (
                                        <FormMessage />
                                    )}
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="confirmPassword"
                            render={({ field }) => (
                                <FormItem>
                                    <div className="flex items-center gap-2">
                                        <FormLabel>
                                            {t("confirmPassword")}
                                        </FormLabel>
                                        {doPasswordsMatch && (
                                            <Check className="h-4 w-4 text-green-500" />
                                        )}
                                    </div>
                                    <FormControl>
                                        <div className="relative">
                                            <Input
                                                type="password"
                                                {...field}
                                                onChange={(e) => {
                                                    field.onChange(e);
                                                    setConfirmPasswordValue(
                                                        e.target.value
                                                    );
                                                }}
                                                className={cn(
                                                    doPasswordsMatch &&
                                                        "border-green-500 focus-visible:ring-green-500",
                                                    confirmPasswordValue.length >
                                                        0 &&
                                                        !doPasswordsMatch &&
                                                        "border-red-500 focus-visible:ring-red-500"
                                                )}
                                                autoComplete="new-password"
                                            />
                                        </div>
                                    </FormControl>
                                    {confirmPasswordValue.length > 0 &&
                                        !doPasswordsMatch && (
                                            <p className="text-sm text-red-600 mt-1">
                                                {t("passwordsDoNotMatch")}
                                            </p>
                                        )}
                                    {/* Only show FormMessage when field is empty */}
                                    {confirmPasswordValue.length === 0 && (
                                        <FormMessage />
                                    )}
                                </FormItem>
                            )}
                        />
                        {build === "saas" && (
                            <>
                                <FormField
                                    control={form.control}
                                    name="agreeToTerms"
                                    render={({ field }) => (
                                        <FormItem className="flex flex-row items-center">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={(checked) => {
                                                        field.onChange(checked);
                                                        handleTermsChange(
                                                            checked as boolean
                                                        );
                                                    }}
                                                />
                                            </FormControl>
                                            <div className="leading-none">
                                                <FormLabel className="text-sm font-normal">
                                                    <div>
                                                        {t(
                                                            "signUpTerms.IAgreeToThe"
                                                        )}{" "}
                                                        <a
                                                            href="https://pangolin.net/terms-of-service.html"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-primary hover:underline"
                                                        >
                                                            {t(
                                                                "signUpTerms.termsOfService"
                                                            )}{" "}
                                                        </a>
                                                        {t("signUpTerms.and")}{" "}
                                                        <a
                                                            href="https://pangolin.net/privacy-policy.html"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-primary hover:underline"
                                                        >
                                                            {t(
                                                                "signUpTerms.privacyPolicy"
                                                            )}
                                                        </a>
                                                    </div>
                                                </FormLabel>
                                                <FormMessage />
                                            </div>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="marketingEmailConsent"
                                    render={({ field }) => (
                                        <FormItem className="flex flex-row items-start">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                />
                                            </FormControl>
                                            <div className="leading-none">
                                                <FormLabel className="text-sm font-normal">
                                                    {t("signUpMarketing.keepMeInTheLoop")}
                                                </FormLabel>
                                                <FormMessage />
                                            </div>
                                        </FormItem>
                                    )}
                                />
                            </>
                        )}

                        {error && (
                            <Alert variant="destructive">
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
                        )}

                        <Button type="submit" className="w-full">
                            {t("createAccount")}
                        </Button>
                    </form>
                </Form>
            </CardContent>
        </Card>
    );
}
