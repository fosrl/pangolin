"use client";

import { Button } from "@app/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { Input } from "@app/components/ui/input";
import { Checkbox } from "@app/components/ui/checkbox";
import { toast } from "@app/hooks/useToast";
import { zodResolver } from "@hookform/resolvers/zod";
import { AxiosResponse } from "axios";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import CopyTextBox from "@app/components/CopyTextBox";
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
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { GenerateNewLicenseResponse } from "@server/routers/generatedLicense/types";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { InfoIcon } from "lucide-react";
import { useUserContext } from "@app/hooks/useUserContext";

const FORM_ID = "generate-personal-license-form";

const formSchema = z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    primaryUse: z.string().min(1),
    country: z.string().min(1),
    phoneNumber: z.string().optional(),
    agreedToTerms: z.boolean().refine((val) => val === true),
    complianceConfirmed: z.boolean().refine((val) => val === true)
});

type FormData = z.infer<typeof formSchema>;

const defaultValues: FormData = {
    firstName: "",
    lastName: "",
    primaryUse: "",
    country: "",
    phoneNumber: "",
    agreedToTerms: false,
    complianceConfirmed: false
};

type GeneratePersonalLicenseFormProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
    orgId: string;
    onGenerated?: () => void;
};

/** Free personal-use license key. Paid keys are bought on the website. */
export default function GeneratePersonalLicenseForm({
    open,
    setOpen,
    orgId,
    onGenerated
}: GeneratePersonalLicenseFormProps) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const { user } = useUserContext();

    const [loading, setLoading] = useState(false);
    const [generatedKey, setGeneratedKey] = useState<string | null>(null);

    const form = useForm<FormData>({
        resolver: zodResolver(formSchema),
        defaultValues
    });

    useEffect(() => {
        if (open) {
            form.reset(defaultValues);
            setGeneratedKey(null);
        }
    }, [open]);

    async function onSubmit(values: FormData) {
        setLoading(true);
        try {
            const response = await api.put<
                AxiosResponse<GenerateNewLicenseResponse>
            >(`/org/${orgId}/license`, {
                email: user?.email ?? "",
                useCaseType: "personal",
                personal: {
                    firstName: values.firstName,
                    lastName: values.lastName,
                    aboutYou: { primaryUse: values.primaryUse },
                    personalInfo: {
                        country: values.country,
                        phoneNumber: values.phoneNumber || ""
                    }
                },
                consent: {
                    agreedToTerms: values.agreedToTerms,
                    acknowledgedPrivacyPolicy: values.agreedToTerms,
                    complianceConfirmed: values.complianceConfirmed
                }
            });
            const key = response.data.data?.licenseKey?.licenseKey;
            if (key) {
                setGeneratedKey(key);
                onGenerated?.();
                toast({
                    title: t("generateLicenseKeyForm.toasts.success.title"),
                    description: t(
                        "generateLicenseKeyForm.toasts.success.description"
                    )
                });
            }
        } catch (e) {
            toast({
                title: t("generateLicenseKeyForm.toasts.error.title"),
                description: formatAxiosError(
                    e,
                    t("generateLicenseKeyForm.toasts.error.description")
                ),
                variant: "destructive"
            });
        }
        setLoading(false);
    }

    const textField = (
        name:
            "firstName" | "lastName" | "primaryUse" | "country" | "phoneNumber",
        label: string
    ) => (
        <FormField
            control={form.control}
            name={name}
            render={({ field }) => (
                <FormItem>
                    <FormLabel>{label}</FormLabel>
                    <FormControl>
                        <Input {...field} />
                    </FormControl>
                    <FormMessage />
                </FormItem>
            )}
        />
    );

    return (
        <Credenza open={open} onOpenChange={setOpen}>
            <CredenzaContent className="max-w-2xl">
                <CredenzaHeader>
                    <CredenzaTitle>
                        {t("personalLicenseFormTitle")}
                    </CredenzaTitle>
                    <CredenzaDescription>
                        {t("personalLicenseFormDescription")}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                    {generatedKey ? (
                        <CopyTextBox text={generatedKey} wrapText={false} />
                    ) : (
                        <div className="space-y-6">
                            <Alert variant="neutral">
                                <InfoIcon className="h-4 w-4" />
                                <AlertTitle>
                                    {t(
                                        "generateLicenseKeyForm.alerts.commercialUseDisclosure.title"
                                    )}
                                </AlertTitle>
                                <AlertDescription>
                                    {t(
                                        "generateLicenseKeyForm.alerts.commercialUseDisclosure.description"
                                    )}{" "}
                                    <a
                                        href="https://pangolin.net/fcl"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary hover:underline"
                                    >
                                        https://pangolin.net/fcl
                                    </a>
                                </AlertDescription>
                            </Alert>

                            <Form {...form}>
                                <form
                                    onSubmit={form.handleSubmit(onSubmit)}
                                    className="space-y-4"
                                    id={FORM_ID}
                                >
                                    <div className="grid grid-cols-2 gap-4">
                                        {textField(
                                            "firstName",
                                            t(
                                                "generateLicenseKeyForm.form.firstName"
                                            )
                                        )}
                                        {textField(
                                            "lastName",
                                            t(
                                                "generateLicenseKeyForm.form.lastName"
                                            )
                                        )}
                                    </div>
                                    {textField(
                                        "primaryUse",
                                        t(
                                            "generateLicenseKeyForm.form.primaryUseQuestion"
                                        )
                                    )}
                                    <div className="grid grid-cols-2 gap-4">
                                        {textField(
                                            "country",
                                            t(
                                                "generateLicenseKeyForm.form.country"
                                            )
                                        )}
                                        {textField(
                                            "phoneNumber",
                                            t(
                                                "generateLicenseKeyForm.form.phoneNumberOptional"
                                            )
                                        )}
                                    </div>

                                    <div className="space-y-4 pt-4">
                                        <FormField
                                            control={form.control}
                                            name="agreedToTerms"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                                                    <FormControl>
                                                        <Checkbox
                                                            checked={
                                                                field.value
                                                            }
                                                            onCheckedChange={
                                                                field.onChange
                                                            }
                                                        />
                                                    </FormControl>
                                                    <div className="space-y-1 leading-none">
                                                        <FormLabel className="text-sm font-normal">
                                                            <div>
                                                                {t(
                                                                    "signUpTerms.IAgreeToThe"
                                                                )}{" "}
                                                                <a
                                                                    href="https://pangolin.net/tos"
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="text-primary hover:underline"
                                                                >
                                                                    {t(
                                                                        "signUpTerms.termsOfService"
                                                                    )}{" "}
                                                                </a>
                                                                {t(
                                                                    "signUpTerms.and"
                                                                )}{" "}
                                                                <a
                                                                    href="https://pangolin.net/privacy"
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
                                            name="complianceConfirmed"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                                                    <FormControl>
                                                        <Checkbox
                                                            checked={
                                                                field.value
                                                            }
                                                            onCheckedChange={
                                                                field.onChange
                                                            }
                                                        />
                                                    </FormControl>
                                                    <div className="space-y-1 leading-none">
                                                        <FormLabel className="text-sm font-normal">
                                                            <div>
                                                                {t(
                                                                    "generateLicenseKeyForm.form.complianceConfirmation"
                                                                )}{" "}
                                                                <a
                                                                    href="https://pangolin.net/fcl"
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="text-primary hover:underline"
                                                                >
                                                                    https://pangolin.net/fcl
                                                                </a>
                                                            </div>
                                                        </FormLabel>
                                                        <FormMessage />
                                                    </div>
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                </form>
                            </Form>
                        </div>
                    )}
                </CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button variant="outline">
                            {t("generateLicenseKeyForm.buttons.close")}
                        </Button>
                    </CredenzaClose>
                    {!generatedKey && (
                        <Button
                            type="submit"
                            form={FORM_ID}
                            disabled={loading}
                            loading={loading}
                        >
                            {t(
                                "generateLicenseKeyForm.buttons.generateLicenseKey"
                            )}
                        </Button>
                    )}
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
