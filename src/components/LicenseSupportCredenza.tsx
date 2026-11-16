"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
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
import { Textarea } from "@app/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@app/components/ui/select";
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
import { useUserContext } from "@app/hooks/useUserContext";
import { toast } from "@app/hooks/useToast";
import { GeneratedLicenseKey } from "@server/routers/generatedLicense/types";

const FORM_ID = "license-support-form";

type LicenseSupportCredenzaProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
    orgId: string;
    licenseKeys: GeneratedLicenseKey[];
};

function describeKey(
    key: GeneratedLicenseKey,
    supportLabel: (support: GeneratedLicenseKey["support"]) => string
) {
    const short =
        key.licenseKey.length <= 8
            ? key.licenseKey
            : `${key.licenseKey.slice(0, 4)}••••${key.licenseKey.slice(-4)}`;
    const name = key.instanceName ? `${short} (${key.instanceName})` : short;
    return `${name} · ${supportLabel(key.support)}`;
}

/** Support request about a license or self-hosted instance. */
export default function LicenseSupportCredenza({
    open,
    setOpen,
    orgId,
    licenseKeys
}: LicenseSupportCredenzaProps) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const { user } = useUserContext();
    const [loading, setLoading] = useState(false);

    // Licenses without email or priority support can't message support
    const eligibleKeys = licenseKeys.filter(
        (key) => key.support !== "community"
    );

    const supportLabel = (support: GeneratedLicenseKey["support"]) =>
        support === "priority"
            ? t("licenseSupportPriority")
            : t("licenseSupportEmail");

    const formSchema = z.object({
        licenseKey: z.string().min(1, t("licenseSupportLicenseRequired")),
        subject: z
            .string()
            .min(1, t("supportSubjectRequired"))
            .max(255, t("supportSubjectMaxLength")),
        body: z.string().min(1, t("supportMessageRequired"))
    });

    type FormData = z.infer<typeof formSchema>;

    const form = useForm<FormData>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            licenseKey: "",
            subject: "",
            body: ""
        }
    });

    useEffect(() => {
        if (open) {
            form.reset({
                // Nothing to choose between when there is only one
                licenseKey:
                    eligibleKeys.length === 1 ? eligibleKeys[0].licenseKey : "",
                subject: "",
                body: ""
            });
        }
    }, [open]);

    async function onSubmit(values: FormData) {
        setLoading(true);
        try {
            await api.post(`/org/${orgId}/license-support-request`, values);
            toast({
                title: t("supportRequestSentTitle"),
                description: t("supportRequestSentDescription")
            });
            setOpen(false);
        } catch (error) {
            toast({
                variant: "destructive",
                title: t("supportRequestFailedTitle"),
                description: formatAxiosError(
                    error,
                    t("supportRequestFailedDescription")
                )
            });
        } finally {
            setLoading(false);
        }
    }

    return (
        <Credenza open={open} onOpenChange={setOpen}>
            <CredenzaContent>
                <CredenzaHeader>
                    <CredenzaTitle>
                        {t("licenseSupportRequestTitle")}
                    </CredenzaTitle>
                    <CredenzaDescription>
                        {t("licenseSupportRequestDescription")}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                    <Form {...form}>
                        <form
                            id={FORM_ID}
                            onSubmit={form.handleSubmit(onSubmit)}
                            className="space-y-4"
                        >
                            <FormItem>
                                <FormLabel>{t("supportReplyTo")}</FormLabel>
                                <FormControl>
                                    <Input value={user?.email || ""} disabled />
                                </FormControl>
                            </FormItem>

                            <FormField
                                control={form.control}
                                name="licenseKey"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>
                                            {t("licenseSupportLicenseLabel")}
                                        </FormLabel>
                                        <Select
                                            value={field.value}
                                            onValueChange={field.onChange}
                                            disabled={loading}
                                        >
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue
                                                        placeholder={t(
                                                            "licenseSupportLicensePlaceholder"
                                                        )}
                                                    />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {eligibleKeys.map((key) => (
                                                    <SelectItem
                                                        key={key.licenseKey}
                                                        value={key.licenseKey}
                                                    >
                                                        {describeKey(
                                                            key,
                                                            supportLabel
                                                        )}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormDescription>
                                            {t("licenseSupportDetailsIncluded")}
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="subject"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>
                                            {t("supportSubject")}
                                        </FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder={t(
                                                    "supportSubjectPlaceholder"
                                                )}
                                                disabled={loading}
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="body"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>
                                            {t("supportMessage")}
                                        </FormLabel>
                                        <FormControl>
                                            <Textarea
                                                placeholder={t(
                                                    "supportMessagePlaceholder"
                                                )}
                                                rows={5}
                                                disabled={loading}
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </form>
                    </Form>
                </CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button variant="outline" disabled={loading}>
                            {t("cancel")}
                        </Button>
                    </CredenzaClose>
                    <Button type="submit" form={FORM_ID} loading={loading}>
                        {t("supportSend")}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
