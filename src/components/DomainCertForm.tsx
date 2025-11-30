"use client";

import { useTranslations } from "next-intl";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useDomainContext } from "@app/hooks/useDomainContext";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionFooter,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "./Settings";
import { Button } from "./ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
    FormDescription
} from "@app/components/ui/form";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "./ui/select";
import { Input } from "./ui/input";
import { useForm } from "react-hook-form";
import z from "zod";
import { toASCII } from "punycode";
import { zodResolver } from "@hookform/resolvers/zod";
import { build } from "@server/build";
import { Switch } from "./ui/switch";
import { useEffect, useState } from "react";
import { createApiClient } from "@app/lib/api";
import { useToast } from "@app/hooks/useToast";
import { formatAxiosError } from "@app/lib/api";
import { GetDomainResponse } from "@server/routers/domain";

type DomainInfoCardProps = {
    orgId?: string;
    domainId?: string;
    domain: GetDomainResponse;
};

// Helper functions for Unicode domain handling
function toPunycode(domain: string): string {
    try {
        const parts = toASCII(domain);
        return parts;
    } catch (error) {
        return domain.toLowerCase();
    }
}

function isValidDomainFormat(domain: string): boolean {
    const unicodeRegex = /^(?!:\/\/)([^\s.]+\.)*[^\s.]+$/;

    if (!unicodeRegex.test(domain)) {
        return false;
    }

    const parts = domain.split(".");
    for (const part of parts) {
        if (part.length === 0 || part.startsWith("-") || part.endsWith("-")) {
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

const certResolverOptions = [
    { id: "default", title: "Default" },
    { id: "custom", title: "Custom Resolver" }
];

export default function DomainCertForm({
    orgId,
    domainId,
    domain
}: DomainInfoCardProps) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const api = createApiClient(useEnvContext());
    const { toast } = useToast();
    const [saveLoading, setSaveLoading] = useState(false);

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            baseDomain: "",
            type:
                build == "oss" || !env.flags.usePangolinDns ? "wildcard" : "ns",
            certResolver: domain.certResolver,
            preferWildcardCert: false
        }
    });

    useEffect(() => {
        if (domain.domainId) {
            const certResolverValue =
                domain.certResolver && domain.certResolver.trim() !== ""
                    ? domain.certResolver
                    : null;

            form.reset({
                baseDomain: domain.baseDomain || "",
                type:
                    (domain.type as "ns" | "cname" | "wildcard") || "wildcard",
                certResolver: certResolverValue,
                preferWildcardCert: domain.preferWildcardCert || false
            });
        }
    }, [domain]);

    const onSubmit = async (values: FormValues) => {
        if (!orgId || !domainId) {
            toast({
                title: t("error"),
                description: t("orgOrDomainIdMissing", {
                    fallback: "Organization or Domain ID is missing"
                }),
                variant: "destructive"
            });
            return;
        }

        setSaveLoading(true);

        try {
            if (!values.certResolver) {
                values.certResolver = null;
            }

            await api.patch(`/org/${orgId}/domain/${domainId}`, {
                certResolver: values.certResolver,
                preferWildcardCert: values.preferWildcardCert
            });

            toast({
                title: t("success"),
                description: t("domainSettingsUpdated", {
                    fallback: "Domain settings updated successfully"
                }),
                variant: "default"
            });
        } catch (error) {
            toast({
                title: t("error"),
                description: formatAxiosError(error),
                variant: "destructive"
            });
        } finally {
            setSaveLoading(false);
        }
    };

    return (
        <SettingsContainer>
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("domainSetting")}
                    </SettingsSectionTitle>
                </SettingsSectionHeader>

                <SettingsSectionBody>
                    <SettingsSectionForm>
                        <Form {...form}>
                            <form
                                onSubmit={form.handleSubmit(onSubmit)}
                                className="space-y-4"
                                id="domain-settings-form"
                            >
                                <>
                                    <FormField
                                        control={form.control}
                                        name="certResolver"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t("certResolver")}
                                                </FormLabel>
                                                <FormControl>
                                                    <Select
                                                        value={
                                                            field.value === null
                                                                ? "default"
                                                                : field.value ===
                                                                        "" ||
                                                                    (field.value &&
                                                                        field.value !==
                                                                            "default")
                                                                  ? "custom"
                                                                  : "default"
                                                        }
                                                        onValueChange={(
                                                            val
                                                        ) => {
                                                            if (
                                                                val ===
                                                                "default"
                                                            ) {
                                                                field.onChange(
                                                                    null
                                                                );
                                                            } else if (
                                                                val === "custom"
                                                            ) {
                                                                field.onChange(
                                                                    ""
                                                                );
                                                            } else {
                                                                field.onChange(
                                                                    val
                                                                );
                                                            }
                                                        }}
                                                    >
                                                        <SelectTrigger>
                                                            <SelectValue
                                                                placeholder={t(
                                                                    "selectCertResolver"
                                                                )}
                                                            />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {certResolverOptions.map(
                                                                (opt) => (
                                                                    <SelectItem
                                                                        key={
                                                                            opt.id
                                                                        }
                                                                        value={
                                                                            opt.id
                                                                        }
                                                                    >
                                                                        {
                                                                            opt.title
                                                                        }
                                                                    </SelectItem>
                                                                )
                                                            )}
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    {form.watch("certResolver") !== null &&
                                        form.watch("certResolver") !==
                                            "default" && (
                                            <FormField
                                                control={form.control}
                                                name="certResolver"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormControl>
                                                            <Input
                                                                placeholder={t(
                                                                    "enterCustomResolver"
                                                                )}
                                                                value={
                                                                    field.value ||
                                                                    ""
                                                                }
                                                                onChange={(e) =>
                                                                    field.onChange(
                                                                        e.target
                                                                            .value
                                                                    )
                                                                }
                                                            />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        )}

                                    {form.watch("certResolver") !== null &&
                                        form.watch("certResolver") !==
                                            "default" && (
                                            <FormField
                                                control={form.control}
                                                name="preferWildcardCert"
                                                render={({
                                                    field: switchField
                                                }) => (
                                                    <FormItem className="items-center space-y-2 mt-4">
                                                        <FormControl>
                                                            <div className="flex items-center space-x-2">
                                                                <Switch
                                                                    checked={
                                                                        switchField.value
                                                                    }
                                                                    onCheckedChange={
                                                                        switchField.onChange
                                                                    }
                                                                />
                                                                <FormLabel>
                                                                    {t(
                                                                        "preferWildcardCert"
                                                                    )}
                                                                </FormLabel>
                                                            </div>
                                                        </FormControl>

                                                        <FormDescription>
                                                            {t(
                                                                "preferWildcardCertDescription"
                                                            )}
                                                        </FormDescription>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        )}
                                </>
                            </form>
                        </Form>
                    </SettingsSectionForm>
                </SettingsSectionBody>

                <SettingsSectionFooter>
                    <Button
                        type="submit"
                        loading={saveLoading}
                        disabled={saveLoading}
                        form="domain-settings-form"
                    >
                        {t("saveSettings")}
                    </Button>
                </SettingsSectionFooter>
            </SettingsSection>
        </SettingsContainer>
    );
}
