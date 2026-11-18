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
import { Input } from "@app/components/ui/input";
import { Textarea } from "@app/components/ui/textarea";
import { Switch } from "@app/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@app/components/ui/select";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import {
    CUSTOM_DNS_RECORD_TYPES,
    CustomDnsRecordRow,
    CustomDnsRecordType
} from "@server/routers/customDnsRecord/types";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

const FORM_ID = "custom-dns-record-form";

const VALUE_PLACEHOLDERS: Record<CustomDnsRecordType, string> = {
    A: "192.0.2.1",
    AAAA: "2001:db8::1",
    CNAME: "target.example.net",
    MX: "mail.example.net",
    NS: "ns1.example.net",
    SRV: "sip.example.net",
    TXT: "v=spf1 include:example.net ~all"
};

const optionalUint16 = z.number().int().min(0).max(65535).optional();

const formSchema = z.object({
    type: z.enum(CUSTOM_DNS_RECORD_TYPES),
    name: z.string().max(253),
    value: z.string().min(1),
    ttl: z.number().int().min(60).max(86400),
    priority: optionalUint16,
    weight: optionalUint16,
    port: optionalUint16,
    enabled: z.boolean()
});

type FormValues = z.infer<typeof formSchema>;

type CustomDnsRecordCredenzaProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
    orgId: string;
    domainId: string;
    baseDomain: string;
    // null to create a new record
    record: CustomDnsRecordRow | null;
    onSaved: () => void;
};

export default function CustomDnsRecordCredenza({
    open,
    setOpen,
    orgId,
    domainId,
    baseDomain,
    record,
    onSaved
}: CustomDnsRecordCredenzaProps) {
    const t = useTranslations();
    const api = createApiClient(useEnvContext());
    const [loading, setLoading] = useState(false);

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            type: "A",
            name: "",
            value: "",
            ttl: 300,
            enabled: true
        }
    });

    useEffect(() => {
        if (!open) {
            return;
        }
        form.reset({
            type: record?.type ?? "A",
            name: record?.name ?? "",
            value: record?.values.join("\n") ?? "",
            ttl: record?.ttl ?? 300,
            priority: record?.priority ?? undefined,
            weight: record?.weight ?? undefined,
            port: record?.port ?? undefined,
            enabled: record?.enabled ?? true
        });
    }, [open, record, form]);

    const type = form.watch("type");
    const needsPriority = type === "MX" || type === "SRV";
    const isSrv = type === "SRV";

    async function onSubmit(data: FormValues) {
        setLoading(true);
        // Each non-empty line is one value of the record
        const values = data.value
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

        const payload = {
            type: data.type,
            name: data.name,
            values,
            ttl: data.ttl,
            priority: needsPriority ? (data.priority ?? null) : null,
            weight: isSrv ? (data.weight ?? null) : null,
            port: isSrv ? (data.port ?? null) : null,
            enabled: data.enabled
        };

        try {
            const res = record
                ? await api.post(
                      `/org/${orgId}/domain/${domainId}/custom-dns-record/${record.customDnsRecordId}`,
                      payload
                  )
                : await api.put(
                      `/org/${orgId}/domain/${domainId}/custom-dns-record`,
                      payload
                  );

            if (res.status === 200 || res.status === 201) {
                toast({
                    title: record
                        ? t("customDnsRecordUpdated")
                        : t("customDnsRecordCreated")
                });
                setOpen(false);
                onSaved();
            }
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("customDnsRecordSaveError"),
                description: formatAxiosError(e)
            });
        } finally {
            setLoading(false);
        }
    }

    const numberField = (
        name: "ttl" | "priority" | "weight" | "port",
        label: string
    ) => (
        <FormField
            control={form.control}
            name={name}
            render={({ field }) => (
                <FormItem className="flex-1">
                    <FormLabel>{label}</FormLabel>
                    <FormControl>
                        <Input
                            type="number"
                            autoComplete="off"
                            name={field.name}
                            ref={field.ref}
                            onBlur={field.onBlur}
                            value={field.value ?? ""}
                            onChange={(e) => {
                                const v = e.target.value;
                                field.onChange(
                                    v === "" ? undefined : Number(v)
                                );
                            }}
                        />
                    </FormControl>
                    <FormMessage />
                </FormItem>
            )}
        />
    );

    return (
        <Credenza open={open} onOpenChange={setOpen}>
            <CredenzaContent>
                <CredenzaHeader>
                    <CredenzaTitle>
                        {record
                            ? t("customDnsRecordEdit")
                            : t("customDnsRecordCreate")}
                    </CredenzaTitle>
                    <CredenzaDescription>
                        {t("customDnsRecordFormDescription", {
                            domain: baseDomain
                        })}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                    <Form {...form}>
                        <form
                            id={FORM_ID}
                            onSubmit={form.handleSubmit(onSubmit)}
                            className="space-y-4"
                        >
                            <FormField
                                control={form.control}
                                name="type"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t("type")}</FormLabel>
                                        <Select
                                            onValueChange={field.onChange}
                                            value={field.value}
                                        >
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {CUSTOM_DNS_RECORD_TYPES.map(
                                                    (recordType) => (
                                                        <SelectItem
                                                            key={recordType}
                                                            value={recordType}
                                                        >
                                                            {recordType}
                                                        </SelectItem>
                                                    )
                                                )}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t("name")}</FormLabel>
                                        <div className="flex items-center gap-2">
                                            <FormControl>
                                                <Input
                                                    autoComplete="off"
                                                    placeholder="@"
                                                    {...field}
                                                />
                                            </FormControl>
                                            <span className="text-sm text-muted-foreground whitespace-nowrap">
                                                .{baseDomain}
                                            </span>
                                        </div>
                                        <FormDescription>
                                            {t(
                                                "customDnsRecordNameDescription"
                                            )}
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="value"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t("value")}</FormLabel>
                                        <FormControl>
                                            {type !== "CNAME" ? (
                                                <Textarea
                                                    autoComplete="off"
                                                    placeholder={
                                                        VALUE_PLACEHOLDERS[type]
                                                    }
                                                    {...field}
                                                />
                                            ) : (
                                                <Input
                                                    autoComplete="off"
                                                    placeholder={
                                                        VALUE_PLACEHOLDERS[type]
                                                    }
                                                    {...field}
                                                />
                                            )}
                                        </FormControl>
                                        {type !== "CNAME" && (
                                            <FormDescription>
                                                {t(
                                                    "customDnsRecordValueDescription"
                                                )}
                                            </FormDescription>
                                        )}
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            {needsPriority && (
                                <div className="flex gap-4">
                                    {numberField(
                                        "priority",
                                        t("customDnsRecordPriority")
                                    )}
                                    {isSrv &&
                                        numberField(
                                            "weight",
                                            t("customDnsRecordWeight")
                                        )}
                                    {isSrv &&
                                        numberField(
                                            "port",
                                            t("customDnsRecordPort")
                                        )}
                                </div>
                            )}
                            {numberField("ttl", t("TTL"))}
                            <FormField
                                control={form.control}
                                name="enabled"
                                render={({ field }) => (
                                    <FormItem className="flex flex-row items-center gap-3 space-y-0">
                                        <FormControl>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </FormControl>
                                        <FormLabel className="!mt-0">
                                            {t("enabled")}
                                        </FormLabel>
                                    </FormItem>
                                )}
                            />
                        </form>
                    </Form>
                </CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button variant="outline">{t("close")}</Button>
                    </CredenzaClose>
                    <Button
                        type="submit"
                        form={FORM_ID}
                        loading={loading}
                        disabled={loading}
                    >
                        {t("save")}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
