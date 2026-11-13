"use client";

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
import { Label } from "@app/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@app/components/ui/radio-group";
import { Switch } from "@app/components/ui/switch";
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
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { zodResolver } from "@hookform/resolvers/zod";
import { AxiosResponse } from "axios";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { ExternalLink } from "lucide-react";
import { z } from "zod";
import { useTranslations } from "next-intl";
import {
    GeneratedLicenseKey,
    LicenseQuantities,
    LicenseSupport,
    PreviewLicenseUpdateResponse,
    UpdateLicenseResponse
} from "@server/routers/generatedLicense/types";
import { SELF_HOSTED_LIMITS } from "@server/lib/billing/selfHostedLicenseLimits";

const FORM_ID = "edit-license-key-form";

const CONTACT_SALES_URL = "https://pangolin.net/contact";

const SUPPORT_LEVELS: LicenseSupport[] = ["community", "email", "priority"];

const LIMITS = {
    users: SELF_HOSTED_LIMITS.users,
    sites: SELF_HOSTED_LIMITS.sites,
    machineClients: SELF_HOSTED_LIMITS.machineClients
} as const;

function formatMoney(cents: number, currency: string): string {
    return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency.toUpperCase()
    }).format(cents / 100);
}

type EditLicenseKeyCredenzaProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
    orgId: string;
    licenseKey: GeneratedLicenseKey | null;
    onUpdated: (key: UpdateLicenseResponse) => void;
};

/**
 * Change a paid license's users, sites, machine clients, add-ons and support.
 * Shows the prorated charge before confirming; confirming charges it right
 * away. Anything that goes down applies at renewal.
 */
export default function EditLicenseKeyCredenza({
    open,
    setOpen,
    orgId,
    licenseKey,
    onUpdated
}: EditLicenseKeyCredenzaProps) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const api = createApiClient({ env });

    const [loading, setLoading] = useState(false);
    const [pending, setPending] = useState<{
        values: LicenseQuantities;
        preview: PreviewLicenseUpdateResponse;
    } | null>(null);

    // Shown when a value is over what can be bought here
    const [showContactSales, setShowContactSales] = useState(false);

    const formSchema = useMemo(() => {
        const count = (limits: { min: number; max: number }) =>
            z.coerce
                .number<number>({ message: t("licenseEditNumberError") })
                .int({ message: t("licenseEditNumberError") })
                .min(limits.min, {
                    message: t("licenseEditMinError", { min: limits.min })
                });
        // No max here: going over one opens the contact sales dialog on
        // submit instead of an error under the field (the server still
        // enforces it)
        return z.object({
            users: count(LIMITS.users),
            sites: count(LIMITS.sites),
            machineClients: count(LIMITS.machineClients),
            highAvailability: z.boolean(),
            support: z.enum(["community", "email", "priority"])
        });
    }, [t]);

    const form = useForm<LicenseQuantities>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            users: 0,
            sites: 0,
            machineClients: 0,
            highAvailability: false,
            support: "community"
        }
    });

    // Start from what the license renews with, which differs from what the
    // key allows now when a reduction is waiting for renewal
    const renewal: LicenseQuantities | null = licenseKey
        ? (licenseKey.subscription?.renewsWith ?? {
              users: licenseKey.users,
              sites: licenseKey.sites,
              machineClients: licenseKey.machines,
              highAvailability: licenseKey.highAvailability,
              support: licenseKey.support
          })
        : null;

    // Email and priority support need more than 25 users
    const users = Number(form.watch("users"));
    const paidSupportAvailable = users > SELF_HOSTED_LIMITS.supportAboveUsers;
    useEffect(() => {
        if (
            !paidSupportAvailable &&
            form.getValues("support") !== "community"
        ) {
            form.setValue("support", "community");
        }
    }, [paidSupportAvailable]);

    useEffect(() => {
        if (open && renewal) {
            form.reset(renewal);
            setPending(null);
            setShowContactSales(false);
        }
    }, [open, licenseKey]);

    if (!licenseKey || !renewal) {
        return null;
    }

    const path = `/org/${orgId}/license/${encodeURIComponent(licenseKey.licenseKey)}`;

    async function onReview(values: LicenseQuantities) {
        const overMax = (Object.keys(LIMITS) as (keyof typeof LIMITS)[]).some(
            (name) => values[name] > LIMITS[name].max
        );
        if (overMax) {
            setShowContactSales(true);
            return;
        }

        if (
            values.users === renewal!.users &&
            values.sites === renewal!.sites &&
            values.machineClients === renewal!.machineClients &&
            values.highAvailability === renewal!.highAvailability &&
            values.support === renewal!.support
        ) {
            toast({
                title: t("licenseEditNoChangesTitle"),
                description: t("licenseEditNoChangesDescription")
            });
            return;
        }

        setLoading(true);
        try {
            const res = await api.post<
                AxiosResponse<PreviewLicenseUpdateResponse>
            >(`${path}/preview`, values);
            setPending({ values, preview: res.data.data });
        } catch (e) {
            toast({
                title: t("licenseEditPreviewError"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        }
        setLoading(false);
    }

    async function onConfirm() {
        if (!pending) return;
        setLoading(true);
        try {
            const res = await api.post<AxiosResponse<UpdateLicenseResponse>>(
                path,
                pending.values
            );
            toast({
                title: t("licenseEditSuccessTitle"),
                description: t("licenseEditSuccessDescription")
            });
            onUpdated(res.data.data);
            setOpen(false);
        } catch (e) {
            toast({
                title: t("licenseEditError"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        }
        setLoading(false);
    }

    const included = licenseKey.subscription?.includedMachineClients ?? 0;

    const supportLabels: Record<LicenseSupport, string> = {
        community: t("licenseSupportCommunity"),
        email: t("licenseSupportEmail"),
        priority: t("licenseSupportPriority")
    };
    const supportDescriptions: Record<LicenseSupport, string> = {
        community: t("licenseSupportCommunityDescription"),
        email: t("licenseSupportEmailDescription"),
        priority: t("licenseSupportPriorityDescription")
    };

    const numberField = (
        name: "users" | "sites" | "machineClients",
        label: string,
        limits: { min: number; max: number },
        description?: string
    ) => (
        <FormField
            control={form.control}
            name={name}
            render={({ field }) => (
                <FormItem>
                    <FormLabel>{label}</FormLabel>
                    <FormControl>
                        <Input type="number" {...field} />
                    </FormControl>
                    <FormDescription>
                        {description ??
                            t("licenseEditRange", {
                                min: limits.min,
                                max: limits.max
                            })}
                    </FormDescription>
                    <FormMessage />
                </FormItem>
            )}
        />
    );

    return (
        <>
            <Credenza open={open} onOpenChange={setOpen}>
                <CredenzaContent>
                    <CredenzaHeader>
                        <CredenzaTitle>{t("licenseEditTitle")}</CredenzaTitle>
                    </CredenzaHeader>
                    <CredenzaBody>
                        {pending ? (
                            <div className="space-y-4">
                                <div>
                                    <div className="text-3xl font-semibold">
                                        {pending.preview.amountDue > 0
                                            ? formatMoney(
                                                  pending.preview.amountDue,
                                                  pending.preview.currency
                                              )
                                            : t("licenseEditNoChargeTitle")}
                                    </div>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        {pending.preview.amountDue > 0
                                            ? t(
                                                  "licenseEditChargeNowDescription"
                                              )
                                            : t(
                                                  "licenseEditNoChargeDescription"
                                              )}
                                    </p>
                                </div>
                                <div className="rounded-lg border p-4 space-y-1 text-sm">
                                    <div>
                                        {t("licenseEditSummary", {
                                            users: pending.values.users,
                                            sites: pending.values.sites,
                                            machineClients:
                                                pending.values.machineClients
                                        })}
                                    </div>
                                    <div>
                                        {t("licenseEditSummaryAddons", {
                                            highAvailability: pending.values
                                                .highAvailability
                                                ? t("licenseEditOn")
                                                : t("licenseEditOff"),
                                            support:
                                                supportLabels[
                                                    pending.values.support
                                                ]
                                        })}
                                    </div>
                                    <div className="text-muted-foreground">
                                        {t(
                                            pending.preview.interval === "month"
                                                ? "licenseEditNewMonthlyTotal"
                                                : "licenseEditNewAnnualTotal",
                                            {
                                                amount: formatMoney(
                                                    pending.preview.newTotal,
                                                    pending.preview.currency
                                                )
                                            }
                                        )}
                                    </div>
                                </div>
                                {pending.preview.reductionsApplyAt && (
                                    <p className="text-sm text-muted-foreground">
                                        {t("licenseEditReductionsAtRenewal", {
                                            date: new Date(
                                                pending.preview
                                                    .reductionsApplyAt
                                            ).toLocaleDateString()
                                        })}
                                    </p>
                                )}
                            </div>
                        ) : (
                            <Form {...form}>
                                <form
                                    id={FORM_ID}
                                    onSubmit={form.handleSubmit(onReview)}
                                    className="space-y-4"
                                >
                                    <p className="text-sm">
                                        {t("licenseEditDescription")}
                                    </p>
                                    {numberField(
                                        "users",
                                        t("users"),
                                        SELF_HOSTED_LIMITS.users
                                    )}
                                    {numberField(
                                        "sites",
                                        t("sites"),
                                        SELF_HOSTED_LIMITS.sites
                                    )}
                                    {numberField(
                                        "machineClients",
                                        t("machineClients"),
                                        SELF_HOSTED_LIMITS.machineClients,
                                        t(
                                            "licenseEditMachineClientsDescription",
                                            {
                                                included,
                                                min: SELF_HOSTED_LIMITS
                                                    .machineClients.min,
                                                max: SELF_HOSTED_LIMITS
                                                    .machineClients.max
                                            }
                                        )
                                    )}
                                    <FormField
                                        control={form.control}
                                        name="highAvailability"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t("licenseAddons")}
                                                </FormLabel>
                                                <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                                                    <div className="space-y-0.5">
                                                        <Label
                                                            htmlFor="license-high-availability"
                                                            className="cursor-pointer"
                                                        >
                                                            {t(
                                                                "licenseHighAvailability"
                                                            )}
                                                        </Label>
                                                        <FormDescription>
                                                            {t(
                                                                "licenseHighAvailabilityDescription"
                                                            )}
                                                        </FormDescription>
                                                    </div>
                                                    <FormControl>
                                                        <Switch
                                                            id="license-high-availability"
                                                            checked={
                                                                field.value
                                                            }
                                                            onCheckedChange={
                                                                field.onChange
                                                            }
                                                        />
                                                    </FormControl>
                                                </div>
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="support"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t("licenseSupport")}
                                                </FormLabel>
                                                {!paidSupportAvailable && (
                                                    <FormDescription>
                                                        {t(
                                                            "licenseSupportNeedsUsers",
                                                            {
                                                                users: SELF_HOSTED_LIMITS.supportAboveUsers
                                                            }
                                                        )}
                                                    </FormDescription>
                                                )}
                                                <FormControl>
                                                    <RadioGroup
                                                        value={field.value}
                                                        onValueChange={
                                                            field.onChange
                                                        }
                                                        className="gap-2"
                                                    >
                                                        {SUPPORT_LEVELS.map(
                                                            (level) => {
                                                                const disabled =
                                                                    level !==
                                                                        "community" &&
                                                                    !paidSupportAvailable;
                                                                return (
                                                                    <div
                                                                        key={
                                                                            level
                                                                        }
                                                                        className={`flex items-start gap-3 rounded-md border p-3 ${disabled ? "opacity-50" : ""}`}
                                                                    >
                                                                        <RadioGroupItem
                                                                            disabled={
                                                                                disabled
                                                                            }
                                                                            value={
                                                                                level
                                                                            }
                                                                            id={`license-support-${level}`}
                                                                            className="mt-0.5"
                                                                        />
                                                                        <div>
                                                                            <Label
                                                                                htmlFor={`license-support-${level}`}
                                                                                className="cursor-pointer font-medium"
                                                                            >
                                                                                {
                                                                                    supportLabels[
                                                                                        level
                                                                                    ]
                                                                                }
                                                                            </Label>
                                                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                                                {
                                                                                    supportDescriptions[
                                                                                        level
                                                                                    ]
                                                                                }
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            }
                                                        )}
                                                    </RadioGroup>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <p className="text-sm text-muted-foreground">
                                        {t("licenseEditLargerDeployments")}{" "}
                                        <a
                                            href={CONTACT_SALES_URL}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-primary hover:underline"
                                        >
                                            {t("licenseEditContactSales")}
                                        </a>
                                    </p>
                                </form>
                            </Form>
                        )}
                    </CredenzaBody>
                    <CredenzaFooter>
                        {pending ? (
                            <>
                                <Button
                                    variant="outline"
                                    onClick={() => setPending(null)}
                                    disabled={loading}
                                >
                                    {t("licenseEditBack")}
                                </Button>
                                <Button
                                    onClick={onConfirm}
                                    disabled={loading}
                                    loading={loading}
                                >
                                    {pending.preview.amountDue > 0
                                        ? t("licenseEditConfirmAndPay")
                                        : t("licenseEditConfirm")}
                                </Button>
                            </>
                        ) : (
                            <>
                                <CredenzaClose asChild>
                                    <Button variant="outline">
                                        {t("cancel")}
                                    </Button>
                                </CredenzaClose>
                                <Button
                                    type="submit"
                                    form={FORM_ID}
                                    disabled={loading}
                                    loading={loading}
                                >
                                    {t("licenseEditReview")}
                                </Button>
                            </>
                        )}
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>

            <Credenza
                open={showContactSales}
                onOpenChange={setShowContactSales}
            >
                <CredenzaContent>
                    <CredenzaHeader>
                        <CredenzaTitle>
                            {t("licenseContactSalesTitle")}
                        </CredenzaTitle>
                        <CredenzaDescription>
                            {t("licenseContactSalesDescription", {
                                users: LIMITS.users.max,
                                sites: LIMITS.sites.max,
                                machineClients: LIMITS.machineClients.max
                            })}
                        </CredenzaDescription>
                    </CredenzaHeader>
                    <CredenzaFooter>
                        <CredenzaClose asChild>
                            <Button variant="outline">{t("close")}</Button>
                        </CredenzaClose>
                        <Button asChild>
                            <a
                                href={CONTACT_SALES_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => setShowContactSales(false)}
                            >
                                {t("licenseEditContactSales")}
                                <ExternalLink className="ml-2 h-4 w-4" />
                            </a>
                        </Button>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>
        </>
    );
}
