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
import { useForm, type Resolver } from "react-hook-form";
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
import { InfoIcon } from "lucide-react";
import { useUserContext } from "@app/hooks/useUserContext";

const TIER_TO_LICENSE_ID = {
    starter: "small_license",
    scale: "big_license"
} as const;

type FormProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
    orgId: string;
    onGenerated?: () => void;
};

export default function NewPricingLicenseForm({
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
    const [personalUseOnly, setPersonalUseOnly] = useState(false);
    const [selectedTier, setSelectedTier] = useState<"starter" | "scale">(
        "starter"
    );

    const personalFormSchema = z.object({
        email: z.email(),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        primaryUse: z.string().min(1),
        country: z.string().min(1),
        phoneNumber: z.string().optional(),
        agreedToTerms: z.boolean().refine((val) => val === true),
        complianceConfirmed: z.boolean().refine((val) => val === true)
    });

    const businessFormSchema = z.object({
        email: z.email(),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        primaryUse: z.string().min(1),
        industry: z.string().min(1),
        companyName: z.string().min(1),
        companyWebsite: z.string().optional(),
        companyPhoneNumber: z.string().optional(),
        agreedToTerms: z.boolean().refine((val) => val === true),
        complianceConfirmed: z.boolean().refine((val) => val === true)
    });

    type PersonalFormData = z.infer<typeof personalFormSchema>;
    type BusinessFormData = z.infer<typeof businessFormSchema>;

    const personalForm = useForm<PersonalFormData>({
        resolver: zodResolver(personalFormSchema) as Resolver<PersonalFormData>,
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

    const businessForm = useForm<BusinessFormData>({
        resolver: zodResolver(businessFormSchema) as Resolver<BusinessFormData>,
        defaultValues: {
            email: user?.email || "",
            firstName: "",
            lastName: "",
            primaryUse: "",
            industry: "",
            companyName: "",
            companyWebsite: "",
            companyPhoneNumber: "",
            agreedToTerms: false,
            complianceConfirmed: false
        }
    });

    React.useEffect(() => {
        if (open) {
            resetForm();
            setGeneratedKey(null);
            setPersonalUseOnly(false);
            setSelectedTier("starter");
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
            primaryUse: "",
            industry: "",
            companyName: "",
            companyWebsite: "",
            companyPhoneNumber: "",
            agreedToTerms: false,
            complianceConfirmed: false
        });
    }

    const tierOptions: StrategyOption<"starter" | "scale">[] = [
        {
            id: "starter",
            title: t("newPricingLicenseForm.tiers.starter.title"),
            description: t("newPricingLicenseForm.tiers.starter.description")
        },
        {
            id: "scale",
            title: t("newPricingLicenseForm.tiers.scale.title"),
            description: t("newPricingLicenseForm.tiers.scale.description")
        }
    ];

    const submitLicenseRequest = async (
        payload: Record<string, unknown>
    ): Promise<void> => {
        setLoading(true);
        try {
            // Check if this is a business/enterprise license request
            if (!personalUseOnly) {
                const response = await api.put<AxiosResponse<string>>(
                    `/org/${orgId}/license/enterprise`,
                    { ...payload, tier: TIER_TO_LICENSE_ID[selectedTier] }
                );

                console.log("Checkout session response:", response.data);
                const checkoutUrl = response.data.data;
                if (checkoutUrl) {
                    window.location.href = checkoutUrl;
                } else {
                    toast({
                        title: "Failed to get checkout URL",
                        description: "Please try again later",
                        variant: "destructive"
                    });
                    setLoading(false);
                }
            } else {
                // Personal license flow
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
        await submitLicenseRequest({
            email: values.email,
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
            business: undefined,
            consent: {
                agreedToTerms: values.agreedToTerms,
                acknowledgedPrivacyPolicy: values.agreedToTerms,
                complianceConfirmed: values.complianceConfirmed
            }
        });
    };

    const onSubmitBusiness = async (values: BusinessFormData) => {
        const payload = {
            email: values.email,
            useCaseType: "business",
            personal: undefined,
            business: {
                firstName: values.firstName,
                lastName: values.lastName,
                jobTitle: "N/A",
                aboutYou: {
                    primaryUse: values.primaryUse,
                    industry: values.industry,
                    prospectiveUsers: 100,
                    prospectiveSites: 100
                },
                companyInfo: {
                    companyName: values.companyName,
                    countryOfResidence: "N/A",
                    stateProvinceRegion: "N/A",
                    postalZipCode: "N/A",
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
                    <CredenzaTitle>
                        {t("newPricingLicenseForm.title")}
                    </CredenzaTitle>
                    <CredenzaDescription>
                        {t("newPricingLicenseForm.description")}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                    <div className="space-y-6">
                        {generatedKey ? (
                            <div className="space-y-4">
                                <CopyTextBox
                                    text={generatedKey}
                                    wrapText={false}
                                />
                            </div>
                        ) : (
                            <>
                                {/* Tier selection - required when not personal use */}
                                {!personalUseOnly && (
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">
                                            {t(
                                                "newPricingLicenseForm.chooseTier"
                                            )}
                                        </label>
                                        <StrategySelect
                                            options={tierOptions}
                                            defaultValue={selectedTier}
                                            onChange={(value) =>
                                                setSelectedTier(value)
                                            }
                                            cols={2}
                                        />
                                        <a
                                            href="https://pangolin.net/pricing"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-sm text-primary hover:underline"
                                        >
                                            {t(
                                                "newPricingLicenseForm.viewPricingLink"
                                            )}
                                        </a>
                                    </div>
                                )}

                                {/* Personal use only checkbox at the bottom of options */}
                                <div className="flex items-center space-x-2">
                                    <Checkbox
                                        id="personal-use-only"
                                        checked={personalUseOnly}
                                        onCheckedChange={(checked) => {
                                            setPersonalUseOnly(
                                                checked === true
                                            );
                                            if (checked) {
                                                businessForm.reset();
                                            } else {
                                                personalForm.reset();
                                            }
                                        }}
                                    />
                                    <label
                                        htmlFor="personal-use-only"
                                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                    >
                                        {t(
                                            "newPricingLicenseForm.personalUseOnly"
                                        )}
                                    </label>
                                </div>

                                {/* License disclosure - only when personal use */}
                                {personalUseOnly && (
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
                                                                href="https://pangolin.net/fcl"
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="text-primary hover:underline"
                                                            >
                                                                Fossorial
                                                                Commercial
                                                                License Terms
                                                            </a>
                                                        )}
                                                    </span>
                                                ))}
                                        </AlertDescription>
                                    </Alert>
                                )}

                                {/* Personal form: only when personal use only is checked */}
                                {personalUseOnly && (
                                    <Form {...personalForm}>
                                        <form
                                            onSubmit={personalForm.handleSubmit(
                                                onSubmitPersonal
                                            )}
                                            className="space-y-4"
                                            id="new-pricing-license-personal-form"
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
                                )}

                                {/* Business form: when not personal use - enter business info then continue to checkout */}
                                {!personalUseOnly && (
                                    <Form {...businessForm}>
                                        <form
                                            onSubmit={businessForm.handleSubmit(
                                                onSubmitBusiness
                                            )}
                                            className="space-y-4"
                                            id="new-pricing-license-business-form"
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

                    {!generatedKey && personalUseOnly && (
                        <Button
                            type="submit"
                            form="new-pricing-license-personal-form"
                            disabled={loading}
                            loading={loading}
                        >
                            {t(
                                "generateLicenseKeyForm.buttons.generateLicenseKey"
                            )}
                        </Button>
                    )}

                    {!generatedKey && !personalUseOnly && (
                        <Button
                            type="submit"
                            form="new-pricing-license-business-form"
                            disabled={loading}
                            loading={loading}
                        >
                            {t(
                                "newPricingLicenseForm.buttons.continueToCheckout"
                            )}
                        </Button>
                    )}
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
