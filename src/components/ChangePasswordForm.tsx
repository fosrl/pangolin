"use client";

import { useState, forwardRef, useImperativeHandle, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Check, X } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { AxiosResponse } from "axios";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { toast } from "@app/hooks/useToast";
import { formatAxiosError } from "@app/lib/api";
import { useTranslations } from "next-intl";
import {
    InputOTP,
    InputOTPGroup,
    InputOTPSlot
} from "./ui/input-otp";
import { REGEXP_ONLY_DIGITS_AND_CHARS } from "input-otp";
import { ChangePasswordResponse } from "@server/routers/auth";
import { cn } from "@app/lib/cn";

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

type ChangePasswordFormProps = {
    onComplete?: () => void;
    onCancel?: () => void;
    isDialog?: boolean;
    submitButtonText?: string;
    cancelButtonText?: string;
    showCancelButton?: boolean;
    onStepChange?: (step: number) => void;
    onLoadingChange?: (loading: boolean) => void;
};

const ChangePasswordForm = forwardRef<
    { handleSubmit: () => void },
    ChangePasswordFormProps
>(
    (
        {
            onComplete,
            onCancel,
            isDialog = false,
            submitButtonText,
            cancelButtonText,
            showCancelButton = false,
            onStepChange,
            onLoadingChange
        },
        ref
    ) => {
        const [step, setStep] = useState(1);
        const [loading, setLoading] = useState(false);
        const [newPasswordValue, setNewPasswordValue] = useState("");
        const [confirmPasswordValue, setConfirmPasswordValue] = useState("");

        const api = createApiClient(useEnvContext());
        const t = useTranslations();

        const passwordStrength = calculatePasswordStrength(newPasswordValue);
        const doPasswordsMatch =
            newPasswordValue.length > 0 &&
            confirmPasswordValue.length > 0 &&
            newPasswordValue === confirmPasswordValue;

        // Notify parent of step and loading changes
        useEffect(() => {
            onStepChange?.(step);
        }, [step, onStepChange]);

        useEffect(() => {
            onLoadingChange?.(loading);
        }, [loading, onLoadingChange]);

        const passwordSchema = z.object({
            oldPassword: z.string().min(1, { message: t("passwordRequired") }),
            newPassword: z.string().min(8, { message: t("passwordRequirementsChars") }),
            confirmPassword: z.string().min(1, { message: t("passwordRequired") })
        }).refine((data) => data.newPassword === data.confirmPassword, {
            message: t("passwordsDoNotMatch"),
            path: ["confirmPassword"],
        });

        const mfaSchema = z.object({
            code: z.string().length(6, { message: t("pincodeInvalid") })
        });

        const passwordForm = useForm({
            resolver: zodResolver(passwordSchema),
            defaultValues: {
                oldPassword: "",
                newPassword: "",
                confirmPassword: ""
            }
        });

        const mfaForm = useForm({
            resolver: zodResolver(mfaSchema),
            defaultValues: {
                code: ""
            }
        });

        const changePassword = async (values: z.infer<typeof passwordSchema>) => {
            setLoading(true);

            const endpoint = `/auth/change-password`;
            const payload = { 
                oldPassword: values.oldPassword,
                newPassword: values.newPassword
            };

            const res = await api
                .post<AxiosResponse<ChangePasswordResponse>>(endpoint, payload)
                .catch((e) => {
                    toast({
                        title: t("changePasswordError"),
                        description: formatAxiosError(
                            e,
                            t("changePasswordErrorDescription")
                        ),
                        variant: "destructive"
                    });
                });

            if (res && res.data) {
                if (res.data.data?.codeRequested) {
                    setStep(2);
                } else {
                    setStep(3);
                }
            }

            setLoading(false);
        };

        const confirmMfa = async (values: z.infer<typeof mfaSchema>) => {
            setLoading(true);

            const endpoint = `/auth/change-password`;
            const passwordValues = passwordForm.getValues();
            const payload = { 
                oldPassword: passwordValues.oldPassword,
                newPassword: passwordValues.newPassword,
                code: values.code
            };

            const res = await api
                .post<AxiosResponse<ChangePasswordResponse>>(endpoint, payload)
                .catch((e) => {
                    toast({
                        title: t("changePasswordError"),
                        description: formatAxiosError(
                            e,
                            t("changePasswordErrorDescription")
                        ),
                        variant: "destructive"
                    });
                });

            if (res && res.data) {
                setStep(3);
            }

            setLoading(false);
        };

        const handleSubmit = () => {
            if (step === 1) {
                passwordForm.handleSubmit(changePassword)();
            } else if (step === 2) {
                mfaForm.handleSubmit(confirmMfa)();
            }
        };

        const handleComplete = () => {
            if (onComplete) {
                onComplete();
            }
        };

        useImperativeHandle(ref, () => ({
            handleSubmit
        }));

        return (
            <div className="space-y-4">
                {step === 1 && (
                    <Form {...passwordForm}>
                        <form
                            onSubmit={passwordForm.handleSubmit(changePassword)}
                            className="space-y-4"
                            id="form"
                        >
                            <div className="space-y-4">
                                <FormField
                                    control={passwordForm.control}
                                    name="oldPassword"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>
                                                {t("oldPassword")}
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

                                <FormField
                                    control={passwordForm.control}
                                    name="newPassword"
                                    render={({ field }) => (
                                        <FormItem>
                                            <div className="flex items-center gap-2">
                                                <FormLabel>
                                                    {t("newPassword")}
                                                </FormLabel>
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
                                                            setNewPasswordValue(
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
                                                                newPasswordValue.length >
                                                                    0 &&
                                                                "border-red-500 focus-visible:ring-red-500"
                                                        )}
                                                        autoComplete="new-password"
                                                    />
                                                </div>
                                            </FormControl>

                                            {newPasswordValue.length > 0 && (
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
                                            {newPasswordValue.length === 0 && (
                                                <FormMessage />
                                            )}
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={passwordForm.control}
                                    name="confirmPassword"
                                    render={({ field }) => (
                                        <FormItem>
                                            <div className="flex items-center gap-2">
                                                <FormLabel>
                                                    {t("confirmNewPassword")}
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
                            </div>
                        </form>
                    </Form>
                )}

                {step === 2 && (
                    <div className="space-y-4">
                        <div className="text-center">
                            <h3 className="text-lg font-medium">{t("otpAuth")}</h3>
                            <p className="text-sm text-muted-foreground">
                                {t("otpAuthDescription")}
                            </p>
                        </div>

                        <Form {...mfaForm}>
                            <form
                                onSubmit={mfaForm.handleSubmit(confirmMfa)}
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
                                                                    confirmMfa
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
                    </div>
                )}

                {step === 3 && (
                    <div className="space-y-4 text-center">
                        <CheckCircle2
                            className="mx-auto text-green-500"
                            size={48}
                        />
                        <p className="font-semibold text-lg">
                            {t("changePasswordSuccess")}
                        </p>
                        <p>{t("changePasswordSuccessDescription")}</p>
                    </div>
                )}

                {/* Action buttons - only show when not in dialog */}
                {!isDialog && (
                    <div className="flex gap-2 justify-end">
                        {showCancelButton && onCancel && (
                            <Button
                                variant="outline"
                                onClick={onCancel}
                                disabled={loading}
                            >
                                {cancelButtonText || "Cancel"}
                            </Button>
                        )}
                        {(step === 1 || step === 2) && (
                            <Button
                                type="button"
                                loading={loading}
                                disabled={loading}
                                onClick={handleSubmit}
                                className="w-full"
                            >
                                {submitButtonText || t("submit")}
                            </Button>
                        )}
                        {step === 3 && (
                            <Button
                                onClick={handleComplete}
                                className="w-full"
                            >
                                {t("continueToApplication")}
                            </Button>
                        )}
                    </div>
                )}
            </div>
        );
    }
);

export default ChangePasswordForm;