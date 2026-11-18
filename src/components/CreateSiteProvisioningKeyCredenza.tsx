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
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { Button } from "@app/components/ui/button";
import { Checkbox } from "@app/components/ui/checkbox";
import { Input } from "@app/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@app/components/ui/alert";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { CreateSiteProvisioningKeyResponse } from "@server/routers/siteProvisioning/types";
import { AxiosResponse } from "axios";
import { InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import CopyTextBox from "@app/components/CopyTextBox";
import {
    DateTimePicker,
    DateTimeValue
} from "@app/components/DateTimePicker";

// Expiry dates must be in the future, within a reasonable horizon.
const EXPIRY_YEARS_AHEAD = 10;
const getExpiryBounds = () => {
    const now = new Date();
    return {
        minDate: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
        maxDate: new Date(now.getFullYear() + EXPIRY_YEARS_AHEAD, 11, 31)
    };
};

const FORM_ID = "create-site-provisioning-key-form";

type CreateSiteProvisioningKeyCredenzaProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
    orgId: string;
};

export default function CreateSiteProvisioningKeyCredenza({
    open,
    setOpen,
    orgId
}: CreateSiteProvisioningKeyCredenzaProps) {
    const t = useTranslations();
    const router = useRouter();
    const api = createApiClient(useEnvContext());
    const [loading, setLoading] = useState(false);
    const [created, setCreated] =
        useState<CreateSiteProvisioningKeyResponse | null>(null);

    const createFormSchema = z
        .object({
            name: z
                .string()
                .min(1, {
                    message: t("nameMin", { len: 1 })
                })
                .max(255, {
                    message: t("nameMax", { len: 255 })
                }),
            unlimitedBatchSize: z.boolean(),
            maxBatchSize: z
                .number()
                .int()
                .min(1, { message: t("provisioningKeysMaxBatchSizeInvalid") })
                .max(1_000_000, {
                    message: t("provisioningKeysMaxBatchSizeInvalid")
                }),
            validUntil: z.string().optional(),
            approveNewSites: z.boolean()
        })
        .superRefine((data, ctx) => {
            const v = data.validUntil;
            if (v == null || v.trim() === "") {
                return;
            }
            if (Number.isNaN(Date.parse(v))) {
                ctx.addIssue({
                    code: "custom",
                    message: t("provisioningKeysValidUntilInvalid"),
                    path: ["validUntil"]
                });
            }
        });

    type CreateFormValues = z.infer<typeof createFormSchema>;

    const form = useForm<CreateFormValues>({
        resolver: zodResolver(createFormSchema),
        defaultValues: {
            name: "",
            unlimitedBatchSize: false,
            maxBatchSize: 100,
            validUntil: "",
            approveNewSites: true
        }
    });

    useEffect(() => {
        if (!open) {
            setCreated(null);
            form.reset({
                name: "",
                unlimitedBatchSize: false,
                maxBatchSize: 100,
                validUntil: "",
                approveNewSites: true
            });
        }
    }, [open, form]);

    async function onSubmit(data: CreateFormValues) {
        setLoading(true);
        try {
            const res = await api
                .put<AxiosResponse<CreateSiteProvisioningKeyResponse>>(
                    `/org/${orgId}/site-provisioning-key`,
                    {
                        name: data.name,
                        maxBatchSize: data.unlimitedBatchSize
                            ? null
                            : data.maxBatchSize,
                        validUntil:
                            data.validUntil == null ||
                            data.validUntil.trim() === ""
                                ? undefined
                                : data.validUntil,
                        approveNewSites: data.approveNewSites
                    }
                )
                .catch((e) => {
                    toast({
                        variant: "destructive",
                        title: t("provisioningKeysErrorCreate"),
                        description: formatAxiosError(e)
                    });
                });

            if (res && res.status === 201) {
                setCreated(res.data.data);
                router.refresh();
            }
        } finally {
            setLoading(false);
        }
    }

    const credential = created && created.siteProvisioningKey;

    const unlimitedBatchSize = form.watch("unlimitedBatchSize");

    return (
        <Credenza open={open} onOpenChange={setOpen}>
            <CredenzaContent>
                <CredenzaHeader>
                    <CredenzaTitle>
                        {created
                            ? t("provisioningKeysList")
                            : t("provisioningKeysCreate")}
                    </CredenzaTitle>
                    {!created && (
                        <CredenzaDescription>
                            {t("provisioningKeysCreateDescription")}
                        </CredenzaDescription>
                    )}
                </CredenzaHeader>
                <CredenzaBody>
                    {!created && (
                        <Form {...form}>
                            <form
                                id={FORM_ID}
                                onSubmit={form.handleSubmit(onSubmit)}
                                className="space-y-4"
                            >
                                <FormField
                                    control={form.control}
                                    name="name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t("name")}</FormLabel>
                                            <FormControl>
                                                <Input
                                                    autoComplete="off"
                                                    {...field}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="maxBatchSize"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>
                                                {t(
                                                    "provisioningKeysMaxBatchSize"
                                                )}
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="number"
                                                    min={1}
                                                    max={1_000_000}
                                                    autoComplete="off"
                                                    disabled={unlimitedBatchSize}
                                                    name={field.name}
                                                    ref={field.ref}
                                                    onBlur={field.onBlur}
                                                    onChange={(e) => {
                                                        const v = e.target.value;
                                                        field.onChange(
                                                            v === ""
                                                                ? 100
                                                                : Number(v)
                                                        );
                                                    }}
                                                    value={field.value}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="unlimitedBatchSize"
                                    render={({ field }) => (
                                        <FormItem className="flex flex-row items-center gap-3 space-y-0">
                                            <FormControl>
                                                <Checkbox
                                                    id="provisioning-unlimited-batch"
                                                    checked={field.value}
                                                    onCheckedChange={(c) =>
                                                        field.onChange(
                                                            c === true
                                                        )
                                                    }
                                                />
                                            </FormControl>
                                            <FormLabel
                                                htmlFor="provisioning-unlimited-batch"
                                                className="cursor-pointer font-normal !mt-0"
                                            >
                                                {t(
                                                    "provisioningKeysUnlimitedBatchSize"
                                                )}
                                            </FormLabel>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="validUntil"
                                    render={({ field }) => {
                                        const dateTimeValue: DateTimeValue =
                                            (() => {
                                                if (!field.value) return {};
                                                const d = new Date(field.value);
                                                if (isNaN(d.getTime()))
                                                    return {};
                                                const hours = d
                                                    .getHours()
                                                    .toString()
                                                    .padStart(2, "0");
                                                const minutes = d
                                                    .getMinutes()
                                                    .toString()
                                                    .padStart(2, "0");
                                                const seconds = d
                                                    .getSeconds()
                                                    .toString()
                                                    .padStart(2, "0");
                                                return {
                                                    date: d,
                                                    time: `${hours}:${minutes}:${seconds}`
                                                };
                                            })();

                                        return (
                                            <FormItem>
                                                <FormLabel>
                                                    {t(
                                                        "provisioningKeysValidUntil"
                                                    )}
                                                </FormLabel>
                                                <FormControl>
                                                    <DateTimePicker
                                                        value={dateTimeValue}
                                                        {...getExpiryBounds()}
                                                        onChange={(value) => {
                                                            if (!value.date) {
                                                                field.onChange(
                                                                    ""
                                                                );
                                                                return;
                                                            }
                                                            const d = new Date(
                                                                value.date
                                                            );
                                                            if (value.time) {
                                                                const [h, m, s] =
                                                                    value.time.split(
                                                                        ":"
                                                                    );
                                                                d.setHours(
                                                                    parseInt(
                                                                        h,
                                                                        10
                                                                    ),
                                                                    parseInt(
                                                                        m,
                                                                        10
                                                                    ),
                                                                    parseInt(
                                                                        s || "0",
                                                                        10
                                                                    )
                                                                );
                                                            }
                                                            field.onChange(
                                                                d.toISOString()
                                                            );
                                                        }}
                                                    />
                                                </FormControl>
                                                <FormDescription>
                                                    {t(
                                                        "provisioningKeysValidUntilHint"
                                                    )}
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        );
                                    }}
                                />
                                <FormField
                                    control={form.control}
                                    name="approveNewSites"
                                    render={({ field }) => (
                                        <FormItem className="flex flex-row items-start gap-3 space-y-0">
                                            <FormControl>
                                                <Checkbox
                                                    id="provisioning-approve-new-sites"
                                                    checked={field.value}
                                                    onCheckedChange={(c) =>
                                                        field.onChange(
                                                            c === true
                                                        )
                                                    }
                                                />
                                            </FormControl>
                                            <div className="flex flex-col gap-1">
                                                <FormLabel
                                                    htmlFor="provisioning-approve-new-sites"
                                                    className="cursor-pointer font-normal !mt-0"
                                                >
                                                    {t(
                                                        "provisioningKeysApproveNewSites"
                                                    )}
                                                </FormLabel>
                                                <FormDescription>
                                                    {t(
                                                        "provisioningKeysApproveNewSitesDescription"
                                                    )}
                                                </FormDescription>
                                            </div>
                                        </FormItem>
                                    )}
                                />
                            </form>
                        </Form>
                    )}

                    {created && credential && (
                        <div className="space-y-4">
                            <Alert variant="neutral">
                                <InfoIcon className="h-4 w-4" />
                                <AlertTitle className="font-semibold">
                                    {t("provisioningKeysSave")}
                                </AlertTitle>
                                <AlertDescription>
                                    {t("provisioningKeysSaveDescription")}
                                </AlertDescription>
                            </Alert>
                            <CopyTextBox text={credential} />
                        </div>
                    )}
                </CredenzaBody>
                <CredenzaFooter>
                    {!created ? (
                        <>
                            <CredenzaClose asChild>
                                <Button variant="outline">{t("close")}</Button>
                            </CredenzaClose>
                            <Button
                                type="submit"
                                form={FORM_ID}
                                loading={loading}
                                disabled={loading}
                            >
                                {t("generate")}
                            </Button>
                        </>
                    ) : (
                        <CredenzaClose asChild>
                            <Button variant="default">{t("done")}</Button>
                        </CredenzaClose>
                    )}
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}