"use client";

import { UseFormReturn } from "react-hook-form";
import { Button } from "@app/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "./ui/input-otp";
import { Alert, AlertDescription } from "@app/components/ui/alert";
import { useTranslations } from "next-intl";
import { REGEXP_ONLY_DIGITS } from "input-otp";

const MFA_OTP_INPUT_ID = "mfa-otp-code";

type MfaInputFormProps = {
    form: UseFormReturn<{ code: string }>;
    onSubmit: (values: { code: string }) => void | Promise<void>;
    onBack: () => void;
    error?: string | null;
    loading?: boolean;
    formId?: string;
    username?: string;
};

export default function MfaInputForm({
    form,
    onSubmit,
    onBack,
    error,
    loading = false,
    formId = "mfaForm",
    username
}: MfaInputFormProps) {
    const t = useTranslations();

    return (
        <div className="space-y-4">
            <div className="text-center">
                <h3 className="text-lg font-medium">{t("otpAuth")}</h3>
                <p className="text-sm text-muted-foreground">
                    {t("otpAuthDescription")}
                </p>
            </div>
            <Form {...form}>
                <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="space-y-4"
                    id={formId}
                >
                    {username ? (
                        <input
                            type="text"
                            name="username"
                            autoComplete="username"
                            value={username}
                            readOnly
                            tabIndex={-1}
                            aria-hidden="true"
                            className="sr-only"
                        />
                    ) : null}
                    <FormField
                        control={form.control}
                        name="code"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel
                                    htmlFor={MFA_OTP_INPUT_ID}
                                    className="sr-only"
                                >
                                    {t("otpAuth")}
                                </FormLabel>
                                <FormControl>
                                    <div className="flex justify-center">
                                        <InputOTP
                                            id={MFA_OTP_INPUT_ID}
                                            maxLength={6}
                                            {...field}
                                            autoComplete="one-time-code"
                                            inputMode="numeric"
                                            autoFocus
                                            pattern={REGEXP_ONLY_DIGITS}
                                            onChange={(value: string) => {
                                                field.onChange(value);
                                                if (value.length === 6) {
                                                    form.handleSubmit(
                                                        onSubmit
                                                    )();
                                                }
                                            }}
                                        >
                                            <InputOTPGroup>
                                                <InputOTPSlot index={0} />
                                                <InputOTPSlot index={1} />
                                                <InputOTPSlot index={2} />
                                                <InputOTPSlot index={3} />
                                                <InputOTPSlot index={4} />
                                                <InputOTPSlot index={5} />
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

            {error && (
                <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            <div className="space-y-4">
                <Button
                    type="submit"
                    form={formId}
                    className="w-full"
                    loading={loading}
                    disabled={loading}
                >
                    {t("otpAuthSubmit")}
                </Button>
                <Button
                    type="button"
                    className="w-full"
                    variant="outline"
                    onClick={onBack}
                >
                    {t("otpAuthBack")}
                </Button>
            </div>
        </div>
    );
}
