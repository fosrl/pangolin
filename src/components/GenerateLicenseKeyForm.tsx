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
import { useState } from "react";
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
import { formatAxiosError } from "@app/lib/api";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { GenerateNewLicenseResponse } from "@server/routers/generatedLicense/types";
import { useTranslations } from "next-intl";
import React from "react";
import { StrategySelect, StrategyOption } from "./StrategySelect";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { InfoIcon, Check } from "lucide-react";
import { useUserContext } from "@app/hooks/useUserContext";

type FormProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
    orgId: string;
    onGenerated?: () => void;
};

export default function GenerateLicenseKeyForm({
    open,
    setOpen,
    orgId,
    onGenerated
}: FormProps) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const api = createApiClient({ env });

    const { user } = useUserContext();

    const [loading, setLoading] = useState(false);
    const [generatedKey, setGeneratedKey] = useState<string | null>(null);

    // Personal form schema
    const personalFormSchema = z.object({
        email: z.string().email(),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        primaryUse: z.string().min(1),
        country: z.string().min(1),
        phoneNumber: z.string().optional(),
        agreedToTerms: z.boolean().refine((val) => val === true),
        complianceConfirmed: z.boolean().refine((val) => val === true)
    });

    // Business form schema
    const businessFormSchema = z.object({
        email: z.string().email(),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        jobTitle: z.string().min(1),
        primaryUse: z.string().min(1),
        industry: z.string().min(1),
        prospectiveUsers: z.coerce.number().optional(),
        prospectiveSites: z.coerce.number().optional(),
        companyName: z.string().min(1),
        countryOfResidence: z.string().min(1),
        stateProvinceRegion: z.string().min(1),
        postalZipCode: z.string().min(1),
        companyWebsite: z.string().optional(),
        companyPhoneNumber: z.string().optional(),
        agreedToTerms: z.boolean().refine((val) => val === true),
        complianceConfirmed: z.boolean().refine((val) => val === true)
    });

    type PersonalFormData = z.infer<typeof personalFormSchema>;
    type BusinessFormData = z.infer<typeof businessFormSchema>;

    const [useCaseType, setUseCaseType] = useState<string | undefined>(
        undefined
    );

    // Personal form
    const personalForm = useForm<PersonalFormData>({
        resolver: zodResolver(personalFormSchema),
        defaultValues: {
            email: user?.email || "",
            firstName: "",
            lastName: "",
            primaryUse: "",
            country: "",
            phoneNumber: "",
            agreedToTerms: false,
            complianceConfirmed: false
        }
    });

    // Business form
    const businessForm = useForm<BusinessFormData>({
        resolver: zodResolver(businessFormSchema),
        defaultValues: {
            email: user?.email || "",
            firstName: "",
            lastName: "",
            jobTitle: "",
            primaryUse: "",
            industry: "",
            prospectiveUsers: undefined,
            prospectiveSites: undefined,
            companyName: "",
            countryOfResidence: "",
            stateProvinceRegion: "",
            postalZipCode: "",
            companyWebsite: "",
            companyPhoneNumber: "",
            agreedToTerms: false,
            complianceConfirmed: false
        }
    });

    // Reset form when dialog opens
    React.useEffect(() => {
        if (open) {
            resetForm();
            setGeneratedKey(null);
        }
    }, [open]);

    function resetForm() {
        personalForm.reset({
            email: user?.email || "",
            firstName: "",
            lastName: "",
            primaryUse: "",
            country: "",
            phoneNumber: "",
            agreedToTerms: false,
            complianceConfirmed: false
        });

        businessForm.reset({
            email: user?.email || "",
            firstName: "",
            lastName: "",
            jobTitle: "",
            primaryUse: "",
            industry: "",
            prospectiveUsers: undefined,
            prospectiveSites: undefined,
            companyName: "",
            countryOfResidence: "",
            stateProvinceRegion: "",
            postalZipCode: "",
            companyWebsite: "",
            companyPhoneNumber: "",
            agreedToTerms: false,
            complianceConfirmed: false
        });
    }

    const useCaseOptions: StrategyOption<"personal" | "business">[] = [
        {
            id: "personal",
            title: t("generateLicenseKeyForm.useCaseOptions.personal.title"),
            description: (
                <div className="space-y-2">
                    <p className="text-sm text-muted-foreground mb-2">
                        {t(
                            "generateLicenseKeyForm.useCaseOptions.personal.description"
                        )}
                    </p>
                    <ul className="space-y-2">
                        <li className="flex items-start gap-2">
                            <Check className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                            <span className="text-sm text-muted-foreground break-words">
                                Home-lab enthusiasts and self-hosting hobbyists
                            </span>
                        </li>
                        <li className="flex items-start gap-2">
                            <Check className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                            <span className="text-sm text-muted-foreground break-words">
                                Personal projects, learning, and experimentation
                            </span>
                        </li>
                        <li className="flex items-start gap-2">
                            <Check className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                            <span className="text-sm text-muted-foreground break-words">
                                Individual developers and tech enthusiasts
                            </span>
                        </li>
                    </ul>
                </div>
            )
        },
        {
            id: "business",
            title: t("generateLicenseKeyForm.useCaseOptions.business.title"),
            description: (
                <div className="space-y-2">
                    <p className="text-sm text-muted-foreground mb-2">
                        {t(
                            "generateLicenseKeyForm.useCaseOptions.business.description"
                        )}
                    </p>
                    <ul className="space-y-2">
                        <li className="flex items-start gap-2">
                            <Check className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                            <span className="text-sm text-muted-foreground break-words">
                                Companies, startups, and organizations
                            </span>
                        </li>
                        <li className="flex items-start gap-2">
                            <Check className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                            <span className="text-sm text-muted-foreground break-words">
                                Professional services and client work
                            </span>
                        </li>
                        <li className="flex items-start gap-2">
                            <Check className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                            <span className="text-sm text-muted-foreground break-words">
                                Revenue-generating or commercial use cases
                            </span>
                        </li>
                    </ul>
                </div>
            )
        }
    ];

    const submitLicenseRequest = async (payload: any) => {
        setLoading(true);
        try {
            const response = await api.put<
                AxiosResponse<GenerateNewLicenseResponse>
            >(`/org/${orgId}/license`, payload);

            if (response.data.data?.licenseKey?.licenseKey) {
                setGeneratedKey(response.data.data.licenseKey.licenseKey);
                onGenerated?.();
                toast({
                    title: t("generateLicenseKeyForm.toasts.success.title"),
                    description: t(
                        "generateLicenseKeyForm.toasts.success.description"
                    ),
                    variant: "default"
                });
            }
        } catch (e) {
            console.error(e);
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
    };

    const onSubmitPersonal = async (values: PersonalFormData) => {
        const payload = {
            email: values.email,
            useCaseType: "personal",
            personal: {
                firstName: values.firstName,
                lastName: values.lastName,
                aboutYou: {
                    primaryUse: values.primaryUse
                },
                personalInfo: {
                    country: values.country,
                    phoneNumber: values.phoneNumber || ""
                }
            },
            business: undefined,
            consent: {
                agreedToTerms: values.agreedToTerms,
                acknowledgedPrivacyPolicy: values.agreedToTerms,
                complianceConfirmed: values.complianceConfirmed
            }
        };

        await submitLicenseRequest(payload);
    };

    const onSubmitBusiness = async (values: BusinessFormData) => {
        const payload = {
            email: values.email,
            useCaseType: "business",
            personal: undefined,
            business: {
                firstName: values.firstName,
                lastName: values.lastName,
                jobTitle: values.jobTitle,
                aboutYou: {
                    primaryUse: values.primaryUse,
                    industry: values.industry,
                    prospectiveUsers: values.prospectiveUsers || undefined,
                    prospectiveSites: values.prospectiveSites || undefined
                },
                companyInfo: {
                    companyName: values.companyName,
                    countryOfResidence: values.countryOfResidence,
                    stateProvinceRegion: values.stateProvinceRegion,
                    postalZipCode: values.postalZipCode,
                    companyWebsite: values.companyWebsite || "",
                    companyPhoneNumber: values.companyPhoneNumber || ""
                }
            },
            consent: {
                agreedToTerms: values.agreedToTerms,
                acknowledgedPrivacyPolicy: values.agreedToTerms,
                complianceConfirmed: values.complianceConfirmed
            }
        };

        await submitLicenseRequest(payload);
    };

    const handleClose = () => {
        setOpen(false);
        setGeneratedKey(null);
        resetForm();
    };

    return (
        <Credenza open={open} onOpenChange={handleClose}>
            <CredenzaContent className="max-w-4xl">
                <CredenzaHeader>
                    <CredenzaTitle>{t("generateLicenseKey")}</CredenzaTitle>
                    <CredenzaDescription>
                        {t(
                            "generateLicenseKeyForm.steps.emailLicenseType.description"
                        )}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                    <div className="space-y-6">
                        {generatedKey ? (
                            <div className="space-y-4">
                                {useCaseType === "business" && (
                                    <Alert variant="neutral">
                                        <AlertTitle>
                                            {t(
                                                "generateLicenseKeyForm.alerts.trialPeriodInformation.title"
                                            )}
                                        </AlertTitle>
                                        <AlertDescription>
                                            {t(
                                                "generateLicenseKeyForm.alerts.trialPeriodInformation.description"
                                            )}
                                        </AlertDescription>
                                    </Alert>
                                )}

                                <CopyTextBox
                                    text={generatedKey}
                                    wrapText={false}
                                />
                            </div>
                        ) : (
                            <>
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
                                        )
                                            .split(
                                                "Fossorial Commercial License Terms"
                                            )
                                            .map((part, index) => (
                                                <span key={index}>
                                                    {part}
                                                    {index === 0 && (
                                                        <a
                                                            href="https://pangolin.net/fcl.html"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-primary hover:underline"
                                                        >
                                                            Fossorial Commercial
                                                            License Terms
                                                        </a>
                                                    )}
                                                </span>
                                            ))}
                                    </AlertDescription>
                                </Alert>

                                <div className="space-y-2">
                                    <label className="text-sm font-medium">
                                        {t(
                                            "generateLicenseKeyForm.form.useCaseQuestion"
                                        )}
                                    </label>
                                    <div className="mt-2">
                                        <StrategySelect
                                            options={useCaseOptions}
                                            defaultValue={useCaseType}
                                            onChange={(value) => {
                                                setUseCaseType(value);
                                                resetForm();
                                            }}
                                            cols={2}
                                        />
                                    </div>
                                </div>

                                {useCaseType === "personal" && (
                                    <Form {...personalForm}>
                                        <form
                                            onSubmit={personalForm.handleSubmit(
                                                onSubmitPersonal
                                            )}
                                            className="space-y-4"
                                            id="generate-license-personal-form"
                                        >
                                            <div className="grid grid-cols-2 gap-4">
                                                <FormField
                                                    control={
                                                        personalForm.control
                                                    }
                                                    name="firstName"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel>
                                                                {t(
                                                                    "generateLicenseKeyForm.form.firstName"
                                                                )}
                                                            </FormLabel>
                                                            <FormControl>
                                                                <Input
                                                                    {...field}
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />

                                                <FormField
                                                    control={
                                                        personalForm.control
                                                    }
                                                    name="lastName"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel>
                                                                {t(
                                                                    "generateLicenseKeyForm.form.lastName"
                                                                )}
                                                            </FormLabel>
                                                            <FormControl>
                                                                <Input
                                                                    {...field}
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            </div>

                                            <FormField
                                                control={personalForm.control}
                                                name="primaryUse"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t(
                                                                "generateLicenseKeyForm.form.primaryUseQuestion"
                                                            )}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input {...field} />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            <div className="space-y-4">
                                                <div className="grid grid-cols-2 gap-4">
                                                    <FormField
                                                        control={
                                                            personalForm.control
                                                        }
                                                        name="country"
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel>
                                                                    {t(
                                                                        "generateLicenseKeyForm.form.country"
                                                                    )}
                                                                </FormLabel>
                                                                <FormControl>
                                                                    <Input
                                                                        {...field}
                                                                    />
                                                                </FormControl>
                                                                <FormMessage />
                                                            </FormItem>
                                                        )}
                                                    />

                                                    <FormField
                                                        control={
                                                            personalForm.control
                                                        }
                                                        name="phoneNumber"
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel>
                                                                    {t(
                                                                        "generateLicenseKeyForm.form.phoneNumberOptional"
                                                                    )}
                                                                </FormLabel>
                                                                <FormControl>
                                                                    <Input
                                                                        {...field}
                                                                    />
                                                                </FormControl>
                                                                <FormMessage />
                                                            </FormItem>
                                                        )}
                                                    />
                                                </div>
                                            </div>

                                            <div className="space-y-4 pt-4">
                                                <FormField
                                                    control={
                                                        personalForm.control
                                                    }
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
                                                                            href="https://pangolin.net/terms-of-service.html"
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
                                                    control={
                                                        personalForm.control
                                                    }
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
                                                                        See
                                                                        license
                                                                        details:{" "}
                                                                        <a
                                                                            href="https://pangolin.net/fcl.html"
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            className="text-primary hover:underline"
                                                                        >
                                                                            https://pangolin.net/fcl.html
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
                                )}

                                {useCaseType === "business" && (
                                    <Form {...businessForm}>
                                        <form
                                            onSubmit={businessForm.handleSubmit(
                                                onSubmitBusiness
                                            )}
                                            className="space-y-4"
                                            id="generate-license-business-form"
                                        >
                                            <div className="grid grid-cols-2 gap-4">
                                                <FormField
                                                    control={
                                                        businessForm.control
                                                    }
                                                    name="firstName"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel>
                                                                {t(
                                                                    "generateLicenseKeyForm.form.firstName"
                                                                )}
                                                            </FormLabel>
                                                            <FormControl>
                                                                <Input
                                                                    {...field}
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />

                                                <FormField
                                                    control={
                                                        businessForm.control
                                                    }
                                                    name="lastName"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel>
                                                                {t(
                                                                    "generateLicenseKeyForm.form.lastName"
                                                                )}
                                                            </FormLabel>
                                                            <FormControl>
                                                                <Input
                                                                    {...field}
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            </div>

                                            <FormField
                                                control={businessForm.control}
                                                name="jobTitle"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t(
                                                                "generateLicenseKeyForm.form.jobTitle"
                                                            )}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input {...field} />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={businessForm.control}
                                                name="primaryUse"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t(
                                                                "generateLicenseKeyForm.form.primaryUseQuestion"
                                                            )}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input {...field} />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={businessForm.control}
                                                name="industry"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t(
                                                                "generateLicenseKeyForm.form.industryQuestion"
                                                            )}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input {...field} />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            <div className="grid grid-cols-2 gap-4">
                                                <FormField
                                                    control={
                                                        businessForm.control
                                                    }
                                                    name="prospectiveUsers"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel>
                                                                {t(
                                                                    "generateLicenseKeyForm.form.prospectiveUsersQuestion"
                                                                )}
                                                            </FormLabel>
                                                            <FormControl>
                                                                <Input
                                                                    type="number"
                                                                    {...field}
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />

                                                <FormField
                                                    control={
                                                        businessForm.control
                                                    }
                                                    name="prospectiveSites"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel>
                                                                {t(
                                                                    "generateLicenseKeyForm.form.prospectiveSitesQuestion"
                                                                )}
                                                            </FormLabel>
                                                            <FormControl>
                                                                <Input
                                                                    type="number"
                                                                    {...field}
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            </div>

                                            <FormField
                                                control={businessForm.control}
                                                name="companyName"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t(
                                                                "generateLicenseKeyForm.form.companyName"
                                                            )}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input {...field} />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={businessForm.control}
                                                name="countryOfResidence"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t(
                                                                "generateLicenseKeyForm.form.countryOfResidence"
                                                            )}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input {...field} />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            <div className="grid grid-cols-2 gap-4">
                                                <FormField
                                                    control={
                                                        businessForm.control
                                                    }
                                                    name="stateProvinceRegion"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel>
                                                                {t(
                                                                    "generateLicenseKeyForm.form.stateProvinceRegion"
                                                                )}
                                                            </FormLabel>
                                                            <FormControl>
                                                                <Input
                                                                    {...field}
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />

                                                <FormField
                                                    control={
                                                        businessForm.control
                                                    }
                                                    name="postalZipCode"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel>
                                                                {t(
                                                                    "generateLicenseKeyForm.form.postalZipCode"
                                                                )}
                                                            </FormLabel>
                                                            <FormControl>
                                                                <Input
                                                                    {...field}
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            </div>

                                            <div className="grid grid-cols-2 gap-4">
                                                <FormField
                                                    control={
                                                        businessForm.control
                                                    }
                                                    name="companyWebsite"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel>
                                                                {t(
                                                                    "generateLicenseKeyForm.form.companyWebsite"
                                                                )}
                                                            </FormLabel>
                                                            <FormControl>
                                                                <Input
                                                                    {...field}
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />

                                                <FormField
                                                    control={
                                                        businessForm.control
                                                    }
                                                    name="companyPhoneNumber"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel>
                                                                {t(
                                                                    "generateLicenseKeyForm.form.companyPhoneNumber"
                                                                )}
                                                            </FormLabel>
                                                            <FormControl>
                                                                <Input
                                                                    {...field}
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            </div>

                                            <div className="space-y-4 pt-4">
                                                <FormField
                                                    control={
                                                        businessForm.control
                                                    }
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
                                                                            href="https://pangolin.net/terms-of-service.html"
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
                                                    control={
                                                        businessForm.control
                                                    }
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
                                                                        See
                                                                        license
                                                                        details:{" "}
                                                                        <a
                                                                            href="https://pangolin.net/fcl.html"
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            className="text-primary hover:underline"
                                                                        >
                                                                            https://pangolin.net/fcl.html
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
                                )}
                            </>
                        )}
                    </div>
                </CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button variant="outline">
                            {t("generateLicenseKeyForm.buttons.close")}
                        </Button>
                    </CredenzaClose>

                    {!generatedKey && useCaseType === "personal" && (
                        <Button
                            type="submit"
                            form="generate-license-personal-form"
                            disabled={loading}
                            loading={loading}
                        >
                            {t(
                                "generateLicenseKeyForm.buttons.generateLicenseKey"
                            )}
                        </Button>
                    )}

                    {!generatedKey && useCaseType === "business" && (
                        <Button
                            type="submit"
                            form="generate-license-business-form"
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
