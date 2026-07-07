"use client";

import {
    Credenza,
    CredenzaBody,
    CredenzaClose,
    CredenzaContent,
    CredenzaDescription,
    CredenzaFooter,
    CredenzaHeader,
    CredenzaTitle
} from "@app/components/Credenza";
import { SwitchInput } from "@app/components/SwitchInput";
import { Tag, TagInput } from "@app/components/tags/tag-input";
import { Alert, AlertDescription, AlertTitle } from "@app/components/ui/alert";
import { Button } from "@app/components/ui/button";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { Input } from "@app/components/ui/input";
import {
    InputOTP,
    InputOTPGroup,
    InputOTPSlot
} from "@app/components/ui/input-otp";
import { zodResolver } from "@hookform/resolvers/zod";
import { InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import z from "zod";
import {
    setHeaderAuthSchema,
    setPasswordSchema,
    setPincodeSchema
} from "./policy-auth-method-id";

type CredenzaShellProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: string;
    formId: string;
    submitLabel: string;
    children: React.ReactNode;
};

function CredenzaShell({
    open,
    onOpenChange,
    title,
    description,
    formId,
    submitLabel,
    children
}: CredenzaShellProps) {
    const t = useTranslations();

    return (
        <Credenza open={open} onOpenChange={onOpenChange}>
            <CredenzaContent>
                <CredenzaHeader>
                    <CredenzaTitle>{title}</CredenzaTitle>
                    <CredenzaDescription>{description}</CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>{children}</CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button variant="outline">{t("close")}</Button>
                    </CredenzaClose>
                    <Button type="submit" form={formId}>
                        {submitLabel}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}

type PasscodeCredenzaProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    defaultPassword?: string;
    existingConfigured?: boolean;
    onSave: (password: string) => void;
};

export function PasscodeCredenza({
    open,
    onOpenChange,
    defaultPassword = "",
    existingConfigured,
    onSave
}: PasscodeCredenzaProps) {
    const t = useTranslations();
    const form = useForm({
        resolver: zodResolver(setPasswordSchema),
        defaultValues: { password: defaultPassword }
    });

    useEffect(() => {
        if (open) {
            form.reset({ password: defaultPassword });
        }
    }, [open, defaultPassword, form]);

    return (
        <CredenzaShell
            open={open}
            onOpenChange={onOpenChange}
            title={t("resourcePasswordSetupTitle")}
            description={t("resourcePasswordSetupTitleDescription")}
            formId="policy-passcode-form"
            submitLabel={t("policyAuthSetPasscode")}
        >
            <Form {...form}>
                <form
                    id="policy-passcode-form"
                    onSubmit={form.handleSubmit((data) => {
                        onSave(data.password);
                        onOpenChange(false);
                        form.reset();
                    })}
                    className="space-y-4"
                >
                    <FormField
                        control={form.control}
                        name="password"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>
                                    {t("policyAuthPasscodeTitle")}
                                </FormLabel>
                                <FormControl>
                                    <Input
                                        autoComplete="off"
                                        type="password"
                                        placeholder={
                                            existingConfigured
                                                ? "••••••••"
                                                : undefined
                                        }
                                        {...field}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </form>
            </Form>
        </CredenzaShell>
    );
}

type PincodeCredenzaProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    defaultPincode?: string;
    onSave: (pincode: string) => void;
};

export function PincodeCredenza({
    open,
    onOpenChange,
    defaultPincode = "",
    onSave
}: PincodeCredenzaProps) {
    const t = useTranslations();
    const form = useForm({
        resolver: zodResolver(setPincodeSchema),
        defaultValues: { pincode: defaultPincode }
    });

    useEffect(() => {
        if (open) {
            form.reset({ pincode: defaultPincode });
        }
    }, [open, defaultPincode, form]);

    return (
        <CredenzaShell
            open={open}
            onOpenChange={onOpenChange}
            title={t("resourcePincodeSetupTitle")}
            description={t("resourcePincodeSetupTitleDescription")}
            formId="policy-pincode-form"
            submitLabel={t("policyAuthSetPincode")}
        >
            <Form {...form}>
                <form
                    id="policy-pincode-form"
                    onSubmit={form.handleSubmit((data) => {
                        onSave(data.pincode);
                        onOpenChange(false);
                        form.reset();
                    })}
                    className="space-y-4"
                >
                    <FormField
                        control={form.control}
                        name="pincode"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t("resourcePincode")}</FormLabel>
                                <FormControl>
                                    <div className="flex justify-center">
                                        <InputOTP
                                            maxLength={6}
                                            value={field.value}
                                            onChange={field.onChange}
                                        >
                                            <InputOTPGroup>
                                                {[0, 1, 2, 3, 4, 5].map((i) => (
                                                    <InputOTPSlot
                                                        key={i}
                                                        index={i}
                                                        obscured
                                                    />
                                                ))}
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
        </CredenzaShell>
    );
}

type HeaderAuthCredenzaProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    defaultValues?: {
        user: string;
        password: string;
        extendedCompatibility: boolean;
    };
    existingConfigured?: boolean;
    onSave: (values: z.infer<typeof setHeaderAuthSchema>) => void;
};

export function HeaderAuthCredenza({
    open,
    onOpenChange,
    defaultValues,
    existingConfigured,
    onSave
}: HeaderAuthCredenzaProps) {
    const t = useTranslations();
    const form = useForm({
        resolver: zodResolver(setHeaderAuthSchema),
        defaultValues: {
            user: "",
            password: "",
            extendedCompatibility: true,
            ...defaultValues
        }
    });

    useEffect(() => {
        if (open) {
            form.reset({
                user: defaultValues?.user ?? "",
                password: defaultValues?.password ?? "",
                extendedCompatibility:
                    defaultValues?.extendedCompatibility ?? true
            });
        }
    }, [open, defaultValues, form]);

    return (
        <CredenzaShell
            open={open}
            onOpenChange={onOpenChange}
            title={t("resourceHeaderAuthSetupTitle")}
            description={t("resourceHeaderAuthSetupTitleDescription")}
            formId="policy-header-auth-form"
            submitLabel={t("policyAuthSetHeaderAuth")}
        >
            <Form {...form}>
                <form
                    id="policy-header-auth-form"
                    onSubmit={form.handleSubmit((data) => {
                        onSave(data);
                        onOpenChange(false);
                        form.reset();
                    })}
                    className="space-y-4"
                >
                    <FormField
                        control={form.control}
                        name="user"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>
                                    {t("policyAuthHeaderName")}
                                </FormLabel>
                                <FormControl>
                                    <Input autoComplete="off" {...field} />
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
                                <FormLabel>
                                    {t("policyAuthHeaderValue")}
                                </FormLabel>
                                <FormControl>
                                    <Input
                                        autoComplete="off"
                                        type="password"
                                        placeholder={
                                            existingConfigured
                                                ? "••••••••"
                                                : undefined
                                        }
                                        {...field}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="extendedCompatibility"
                        render={({ field }) => (
                            <FormItem>
                                <FormControl>
                                    <SwitchInput
                                        id="header-auth-compatibility-credenza"
                                        label={t("headerAuthCompatibility")}
                                        description={t(
                                            "headerAuthCompatibilityInfo"
                                        )}
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                </form>
            </Form>
        </CredenzaShell>
    );
}

type EmailCredenzaProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    emailEnabled: boolean;
    disabled?: boolean;
    emails: Tag[];
    onSave: (emails: Tag[]) => void;
};

export function EmailCredenza({
    open,
    onOpenChange,
    emailEnabled,
    disabled,
    emails,
    onSave
}: EmailCredenzaProps) {
    const t = useTranslations();
    const [activeEmailTagIndex, setActiveEmailTagIndex] = useState<
        number | null
    >(null);
    const [draftEmails, setDraftEmails] = useState<Tag[]>(emails);

    useEffect(() => {
        if (open) {
            setDraftEmails(emails);
        }
    }, [open, emails]);

    return (
        <Credenza open={open} onOpenChange={onOpenChange}>
            <CredenzaContent className="max-w-lg">
                <CredenzaHeader>
                    <CredenzaTitle>{t("policyAuthEmailTitle")}</CredenzaTitle>
                    <CredenzaDescription>
                        {t("policyAuthEmailDescription")}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                    <form
                        id="policy-email-form"
                        onSubmit={(event) => {
                            event.preventDefault();
                            onSave(draftEmails);
                            onOpenChange(false);
                        }}
                    >
                        <div className="space-y-4">
                            {!emailEnabled && (
                                <Alert variant="neutral">
                                    <InfoIcon className="h-4 w-4" />
                                    <AlertTitle className="font-semibold">
                                        {t("otpEmailSmtpRequired")}
                                    </AlertTitle>
                                    <AlertDescription>
                                        {t("otpEmailSmtpRequiredDescription")}
                                    </AlertDescription>
                                </Alert>
                            )}
                            {emailEnabled && (
                                <p className="text-sm text-muted-foreground">
                                    {t("otpEmailWhitelistListDescription")}
                                </p>
                            )}
                            {emailEnabled && (
                                <FormItem>
                                    <FormLabel>
                                        {t("otpEmailWhitelistList")}
                                    </FormLabel>
                                    <FormControl>
                                        <TagInput
                                            activeTagIndex={activeEmailTagIndex}
                                            setActiveTagIndex={
                                                setActiveEmailTagIndex
                                            }
                                            placeholder={t("otpEmailEnter")}
                                            tags={draftEmails}
                                            setTags={(newEmails) => {
                                                if (!disabled) {
                                                    setDraftEmails(
                                                        newEmails as Tag[]
                                                    );
                                                }
                                            }}
                                            validateTag={(tag) =>
                                                z
                                                    .email()
                                                    .or(
                                                        z
                                                            .string()
                                                            .regex(
                                                                /^\*@[\w.-]+\.[a-zA-Z]{2,}$/
                                                            )
                                                    )
                                                    .safeParse(tag).success
                                            }
                                            allowDuplicates={false}
                                            sortTags
                                            size="sm"
                                            disabled={disabled}
                                        />
                                    </FormControl>
                                    <FormDescription>
                                        {t("otpEmailEnterDescription")}
                                    </FormDescription>
                                </FormItem>
                            )}
                        </div>
                    </form>
                </CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button variant="outline">{t("close")}</Button>
                    </CredenzaClose>
                    {emailEnabled && (
                        <Button
                            type="submit"
                            form="policy-email-form"
                            disabled={disabled}
                        >
                            {t("policyAuthSetEmailWhitelist")}
                        </Button>
                    )}
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
