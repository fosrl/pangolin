"use client";

import { Button } from "@app/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
    FormDescription
} from "@app/components/ui/form";
import { Input } from "@app/components/ui/input";
import { Checkbox, CheckboxWithLabel } from "@app/components/ui/checkbox";
import { useToast } from "@app/hooks/useToast";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
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
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useTranslations } from "next-intl";
import { formatAxiosError } from "@app/lib/api";
import { CreateDomainResponse } from "@server/routers/domain/createOrgDomain";
import { StrategySelect } from "@app/components/StrategySelect";
import { AxiosResponse } from "axios";
import { Alert, AlertDescription, AlertTitle } from "@app/components/ui/alert";
import { InfoIcon, AlertTriangle, Globe } from "lucide-react";
import CopyToClipboard from "@app/components/CopyToClipboard";
import {
    InfoSection,
    InfoSectionContent,
    InfoSections,
    InfoSectionTitle
} from "@app/components/InfoSection";
import { useOrgContext } from "@app/hooks/useOrgContext";
import { build } from "@server/build";
import { toASCII, toUnicode } from 'punycode';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { useRouter } from "next/navigation";


// Helper functions for Unicode domain handling
function toPunycode(domain: string): string {
    try {
        const parts = toASCII(domain);
        return parts;
    } catch (error) {
        return domain.toLowerCase();
    }
}

function fromPunycode(domain: string): string {
    try {
        const parts = toUnicode(domain);
        return parts;
    } catch (error) {
        return domain;
    }
}

function isValidDomainFormat(domain: string): boolean {
    const unicodeRegex = /^(?!:\/\/)([^\s.]+\.)*[^\s.]+$/;

    if (!unicodeRegex.test(domain)) {
        return false;
    }

    const parts = domain.split('.');
    for (const part of parts) {
        if (part.length === 0 || part.startsWith('-') || part.endsWith('-')) {
            return false;
        }
        if (part.length > 63) {
            return false;
        }
    }

    if (domain.length > 253) {
        return false;
    }

    return true;
}

const formSchema = z.object({
    baseDomain: z
        .string()
        .min(1, "Domain is required")
        .refine((val) => isValidDomainFormat(val), "Invalid domain format")
        .transform((val) => toPunycode(val)),
    type: z.enum(["ns", "cname", "wildcard"]),
    certResolver: z.string().nullable().optional(),
    preferWildcardCert: z.boolean().optional()
});

type FormValues = z.infer<typeof formSchema>;

type CreateDomainFormProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
    onCreated?: (domain: CreateDomainResponse) => void;
};

// Example cert resolver options (replace with real API/fetch if needed)
const certResolverOptions = [
    { id: "default", title: "Default" },
    { id: "custom", title: "Custom Resolver" }
];

export default function CreateDomainForm({
    open,
    setOpen,
    onCreated
}: CreateDomainFormProps) {
    const [loading, setLoading] = useState(false);
    const [createdDomain, setCreatedDomain] =
        useState<CreateDomainResponse | null>(null);
    const api = createApiClient(useEnvContext());
    const t = useTranslations();
    const { toast } = useToast();
    const { org } = useOrgContext();
    const { env } = useEnvContext();
    const router = useRouter();

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            baseDomain: "",
            type: build == "oss" || !env.flags.usePangolinDns ? "wildcard" : "ns",
            certResolver: null,
            preferWildcardCert: false
        }
    });

    const baseDomain = form.watch("baseDomain");
    const domainType = form.watch("type");

    const punycodePreview = useMemo(() => {
        if (!baseDomain) return "";
        const punycode = toPunycode(baseDomain);
        return punycode !== baseDomain.toLowerCase() ? punycode : "";
    }, [baseDomain]);

    const reset = () => {
        form.reset();
        setLoading(false);
        setCreatedDomain(null);
    };

    async function onSubmit(values: FormValues) {
        setLoading(true);
        try {
            const response = await api.put<AxiosResponse<CreateDomainResponse>>(
                `/org/${org.org.orgId}/domain`,
                values
            );
            const domainData = response.data.data;
            setCreatedDomain(domainData);
            toast({
                title: t("success"),
                description: t("domainCreatedDescription")
            });
            onCreated?.(domainData);
            router.push(`/${org.org.orgId}/settings/domains/${domainData.domainId}`);
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        } finally {
            setLoading(false);
        }
    };

    // Domain type options
    let domainOptions: any = [];
    if (build != "oss" && env.flags.usePangolinDns) {
        domainOptions = [
            {
                id: "ns",
                title: t("selectDomainTypeNsName"),
                description: t("selectDomainTypeNsDescription")
            },
            {
                id: "cname",
                title: t("selectDomainTypeCnameName"),
                description: t("selectDomainTypeCnameDescription")
            }
        ];
    } else {
        domainOptions = [
            {
                id: "wildcard",
                title: t("selectDomainTypeWildcardName"),
                description: t("selectDomainTypeWildcardDescription")
            }
        ];
    }

    return (
        <Credenza
            open={open}
            onOpenChange={(val) => {
                setOpen(val);
                reset();
            }}
        >
            <CredenzaContent>
                <CredenzaHeader>
                    <CredenzaTitle>{t("domainAdd")}</CredenzaTitle>
                    <CredenzaDescription>
                        {t("domainAddDescription")}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                        <Form {...form}>
                            <form
                                onSubmit={form.handleSubmit(onSubmit)}
                                className="space-y-4"
                                id="create-domain-form"
                            >
                                <FormField
                                    control={form.control}
                                    name="type"
                                    render={({ field }) => (
                                        <FormItem>
                                            <StrategySelect
                                                options={domainOptions}
                                                defaultValue={field.value}
                                                onChange={field.onChange}
                                                cols={1}
                                            />
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="baseDomain"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t("domain")}</FormLabel>
                                            <FormControl>
                                                <Input
                                                    placeholder="example.com"
                                                    {...field}
                                                />
                                            </FormControl>
                                            {punycodePreview && (
                                                <FormDescription className="flex items-center gap-2 text-xs">
                                                    <Alert>
                                                        <Globe className="h-4 w-4" />
                                                        <AlertTitle>{t("internationaldomaindetected")}</AlertTitle>
                                                        <AlertDescription>
                                                            <div className="mt-2 space-y-1">
                                                                <p>{t("willbestoredas")} <code className="font-mono px-1 py-0.5 rounded">{punycodePreview}</code></p>
                                                            </div>
                                                        </AlertDescription>
                                                    </Alert>
                                                </FormDescription>
                                            )}
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                {domainType === "wildcard" && (
                                    <>
                                        <FormField
                                            control={form.control}
                                            name="certResolver"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>{t("certResolver")}</FormLabel>
                                                    <FormControl>
                                                        <Select
                                                            value={
                                                                field.value === null ? "default" :
                                                                    (field.value === "" || (field.value && field.value !== "default")) ? "custom" :
                                                                        "default"
                                                            }
                                                            onValueChange={(val) => {
                                                                if (val === "default") {
                                                                    field.onChange(null);
                                                                } else if (val === "custom") {
                                                                    field.onChange("");
                                                                } else {
                                                                    field.onChange(val);
                                                                }
                                                            }}
                                                        >
                                                            <SelectTrigger>
                                                                <SelectValue placeholder={t("selectCertResolver")} />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {certResolverOptions.map((opt) => (
                                                                    <SelectItem key={opt.id} value={opt.id}>
                                                                        {opt.title}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        {form.watch("certResolver") !== null &&
                                            form.watch("certResolver") !== "default" && (
                                                <FormField
                                                    control={form.control}
                                                    name="certResolver"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormControl>
                                                                <Input
                                                                    placeholder={t("enterCustomResolver")}
                                                                    value={field.value || ""}
                                                                    onChange={(e) => field.onChange(e.target.value)}
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            )}

                                        {form.watch("certResolver") !== null &&
                                            form.watch("certResolver") !== "default" && (
                                                <FormField
                                                    control={form.control}
                                                    name="preferWildcardCert"
                                                    render={({ field: checkboxField }) => (
                                                        <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                                                            <FormControl>
                                                                <CheckboxWithLabel
                                                                    label={t("preferWildcardCert")}
                                                                    checked={checkboxField.value}
                                                                    onCheckedChange={checkboxField.onChange}
                                                                />
                                                            </FormControl>
                                                                    {/* <div className="space-y-1 leading-none">
                                                                        <FormLabel>
                                                                            {t("preferWildcardCert")}
                                                                        </FormLabel>
                                                                    </div> */}
                                                        </FormItem>
                                                    )}
                                                />
                                            )}
                                    </>
                                )}
                            </form>
                        </Form>

                </CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button variant="outline">{t("close")}</Button>
                    </CredenzaClose>
                    {!createdDomain && (
                        <Button
                            type="submit"
                            form="create-domain-form"
                            loading={loading}
                            disabled={loading}
                        >
                            {t("domainCreate")}
                        </Button>
                    )}
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
