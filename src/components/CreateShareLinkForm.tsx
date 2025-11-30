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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@app/components/ui/select";
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
import { useOrgContext } from "@app/hooks/useOrgContext";
import { formatAxiosError } from "@app/lib/api";
import { cn } from "@app/lib/cn";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { ListResourcesResponse } from "@server/routers/resource";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
import { CaretSortIcon } from "@radix-ui/react-icons";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList
} from "@app/components/ui/command";
import { CheckIcon, ChevronsUpDown } from "lucide-react";
import { Checkbox } from "@app/components/ui/checkbox";
import { GenerateAccessTokenResponse } from "@server/routers/accessToken";
import { constructShareLink } from "@app/lib/shareLinks";
import { ShareLinkRow } from "@app/components/ShareLinksTable";
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from "@app/components/ui/collapsible";
import AccessTokenSection from "@app/components/AccessTokenUsage";
import { useTranslations } from "next-intl";
import { toUnicode } from 'punycode';

type FormProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
    onCreated?: (result: ShareLinkRow) => void;
};

export default function CreateShareLinkForm({
    open,
    setOpen,
    onCreated
}: FormProps) {
    const { org } = useOrgContext();

    const { env } = useEnvContext();
    const api = createApiClient({ env });

    const [link, setLink] = useState<string | null>(null);
    const [accessTokenId, setAccessTokenId] = useState<string | null>(null);
    const [accessToken, setAccessToken] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [neverExpire, setNeverExpire] = useState(false);

    const [isOpen, setIsOpen] = useState(false);
    const t = useTranslations();

    const [resources, setResources] = useState<
        {
            resourceId: number;
            name: string;
            niceId: string;
            resourceUrl: string;
        }[]
    >([]);

    const formSchema = z.object({
        resourceId: z.number({ message: t('shareErrorSelectResource') }),
        resourceName: z.string(),
        resourceUrl: z.string(),
        timeUnit: z.string(),
        timeValue: z.coerce.number().int().positive().min(1),
        title: z.string().optional()
    });

    const timeUnits = [
        { unit: "minutes", name: t('minutes') },
        { unit: "hours", name: t('hours') },
        { unit: "days", name: t('days') },
        { unit: "weeks", name: t('weeks') },
        { unit: "months", name: t('months') },
        { unit: "years", name: t('years') }
    ];

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            timeUnit: "days",
            timeValue: 30,
            title: ""
        }
    });

    useEffect(() => {
        if (!open) {
            return;
        }

        async function fetchResources() {
            const res = await api
                .get<
                    AxiosResponse<ListResourcesResponse>
                >(`/org/${org?.org.orgId}/resources`)
                .catch((e) => {
                    console.error(e);
                    toast({
                        variant: "destructive",
                        title: t('shareErrorFetchResource'),
                        description: formatAxiosError(
                            e,
                            t('shareErrorFetchResourceDescription')
                        )
                    });
                });

            if (res?.status === 200) {
                setResources(
                    res.data.data.resources
                        .filter((r) => {
                            return r.http;
                        })
                        .map((r) => ({
                            resourceId: r.resourceId,
                            name: r.name,
                            niceId: r.niceId,
                            resourceUrl: `${r.ssl ? "https://" : "http://"}${toUnicode(r.fullDomain || "")}/`
                        }))
                );
            }
        }

        fetchResources();
    }, [open]);

    async function onSubmit(values: z.infer<typeof formSchema>) {
        setLoading(true);

        // convert time to seconds
        let timeInSeconds = values.timeValue;
        switch (values.timeUnit) {
            case "minutes":
                timeInSeconds *= 60;
                break;
            case "hours":
                timeInSeconds *= 60 * 60;
                break;
            case "days":
                timeInSeconds *= 60 * 60 * 24;
                break;
            case "weeks":
                timeInSeconds *= 60 * 60 * 24 * 7;
                break;
            case "months":
                timeInSeconds *= 60 * 60 * 24 * 30;
                break;
            case "years":
                timeInSeconds *= 60 * 60 * 24 * 365;
                break;
        }

        const res = await api
            .post<AxiosResponse<GenerateAccessTokenResponse>>(
                `/resource/${values.resourceId}/access-token`,
                {
                    validForSeconds: neverExpire ? undefined : timeInSeconds,
                    title:
                        values.title ||
                        t('shareLink', {resource: (values.resourceName || "Resource" + values.resourceId)})
                }
            )
            .catch((e) => {
                console.error(e);
                toast({
                    variant: "destructive",
                    title: t('shareErrorCreate'),
                    description: formatAxiosError(
                        e,
                        t('shareErrorCreateDescription')
                    )
                });
            });

        if (res && res.data.data.accessTokenId) {
            const token = res.data.data;
            const link = constructShareLink(token.accessToken);
            setLink(link);

            setAccessToken(token.accessToken);
            setAccessTokenId(token.accessTokenId);

            const resource = resources.find(
                (r) => r.resourceId === values.resourceId
            );

            onCreated?.({
                accessTokenId: token.accessTokenId,
                resourceId: token.resourceId,
                resourceName: values.resourceName,
                resourceNiceId: resource ? resource.niceId : "",
                title: token.title,
                createdAt: token.createdAt,
                expiresAt: token.expiresAt
            });
        }

        setLoading(false);
    }

    function getSelectedResourceName(id: number) {
        const resource = resources.find((r) => r.resourceId === id);
        return `${resource?.name}`;
    }

    return (
        <>
            <Credenza
                open={open}
                onOpenChange={(val) => {
                    setOpen(val);
                    setLink(null);
                    setLoading(false);
                    form.reset();
                }}
            >
                <CredenzaContent>
                    <CredenzaHeader>
                        <CredenzaTitle>{t('shareCreate')}</CredenzaTitle>
                        <CredenzaDescription>
                            {t('shareCreateDescription')}
                        </CredenzaDescription>
                    </CredenzaHeader>
                    <CredenzaBody>
                        <div className="space-y-4">
                            {!link && (
                                <Form {...form}>
                                    <form
                                        onSubmit={form.handleSubmit(onSubmit)}
                                        className="space-y-4"
                                        id="share-link-form"
                                    >
                                        <FormField
                                            control={form.control}
                                            name="resourceId"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-col">
                                                    <FormLabel>
                                                        {t('resource')}
                                                    </FormLabel>
                                                    <Popover>
                                                        <PopoverTrigger asChild>
                                                            <FormControl>
                                                                <Button
                                                                    variant="outline"
                                                                    role="combobox"
                                                                    className={cn(
                                                                        "justify-between",
                                                                        !field.value &&
                                                                            "text-muted-foreground"
                                                                    )}
                                                                >
                                                                    {field.value
                                                                        ? getSelectedResourceName(
                                                                              field.value
                                                                          )
                                                                        : t('resourceSelect')}
                                                                    <CaretSortIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                                </Button>
                                                            </FormControl>
                                                        </PopoverTrigger>
                                                        <PopoverContent className="p-0">
                                                            <Command>
                                                                <CommandInput placeholder={t('resourceSearch')} />
                                                                <CommandList>
                                                                    <CommandEmpty>
                                                                        {t('resourcesNotFound')}
                                                                    </CommandEmpty>
                                                                    <CommandGroup>
                                                                        {resources.map(
                                                                            (
                                                                                r
                                                                            ) => (
                                                                                <CommandItem
                                                                                    value={`${r.name}:${r.resourceId}`}
                                                                                    key={
                                                                                        r.resourceId
                                                                                    }
                                                                                    onSelect={() => {
                                                                                        form.setValue(
                                                                                            "resourceId",
                                                                                            r.resourceId
                                                                                        );
                                                                                        form.setValue(
                                                                                            "resourceName",
                                                                                            r.name
                                                                                        );
                                                                                        form.setValue(
                                                                                            "resourceUrl",
                                                                                            r.resourceUrl
                                                                                        );
                                                                                    }}
                                                                                >
                                                                                    <CheckIcon
                                                                                        className={cn(
                                                                                            "mr-2 h-4 w-4",
                                                                                            r.resourceId ===
                                                                                                field.value
                                                                                                ? "opacity-100"
                                                                                                : "opacity-0"
                                                                                        )}
                                                                                    />
                                                                                    {`${r.name}`}
                                                                                </CommandItem>
                                                                            )
                                                                        )}
                                                                    </CommandGroup>
                                                                </CommandList>
                                                            </Command>
                                                        </PopoverContent>
                                                    </Popover>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        <FormField
                                            control={form.control}
                                            name="title"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t('shareTitleOptional')}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        <div className="space-y-4">
                                            <div className="space-y-2">
                                                <FormLabel>{t('expireIn')}</FormLabel>
                                                <div className="grid grid-cols-2 gap-4">
                                                    <FormField
                                                        control={form.control}
                                                        name="timeUnit"
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <Select
                                                                    onValueChange={
                                                                        field.onChange
                                                                    }
                                                                    defaultValue={field.value.toString()}
                                                                    disabled={neverExpire}
                                                                >
                                                                    <FormControl>
                                                                        <SelectTrigger className="w-full">
                                                                            <SelectValue placeholder={t('selectDuration')} />
                                                                        </SelectTrigger>
                                                                    </FormControl>
                                                                    <SelectContent>
                                                                        {timeUnits.map(
                                                                            (
                                                                                option
                                                                            ) => (
                                                                                <SelectItem
                                                                                    key={
                                                                                        option.unit
                                                                                    }
                                                                                    value={
                                                                                        option.unit
                                                                                    }
                                                                                >
                                                                                    {
                                                                                        option.name
                                                                                    }
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
                                                        name="timeValue"
                                                        disabled={neverExpire}
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <FormControl>
                                                                    <Input
                                                                        type="number"
                                                                        min={1}
                                                                        {...field}
                                                                    />
                                                                </FormControl>
                                                                <FormMessage />
                                                            </FormItem>
                                                        )}
                                                    />
                                                </div>
                                            </div>

                                            <div className="flex items-center space-x-2">
                                                <Checkbox
                                                    id="terms"
                                                    checked={neverExpire}
                                                    onCheckedChange={(val) =>
                                                        setNeverExpire(
                                                            val as boolean
                                                        )
                                                    }
                                                />
                                                <label
                                                    htmlFor="terms"
                                                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                                >
                                                    {t('neverExpire')}
                                                </label>
                                            </div>

                                            <p className="text-sm text-muted-foreground">
                                                {t('shareExpireDescription')}
                                            </p>
                                        </div>
                                    </form>
                                </Form>
                            )}
                            {link && (
                                <div className="max-w-md space-y-4">
                                    <p>
                                        {t('shareSeeOnce')}
                                    </p>
                                    <p>
                                        {t('shareAccessHint')}
                                    </p>

                                    <div className="h-[250px] w-full mx-auto flex items-center justify-center">
                                        <div className="bg-white p-6 border rounded-md">
                                        <QRCodeCanvas value={link} size={200} />
                                        </div>
                                    </div>

                                    <Collapsible
                                        open={isOpen}
                                        onOpenChange={setIsOpen}
                                        className="space-y-2"
                                    >
                                        <div className="mx-auto">
                                            <CopyTextBox
                                                text={link}
                                                wrapText={false}
                                            />
                                        </div>
                                        <div className="flex items-center justify-between space-x-4">
                                            <CollapsibleTrigger asChild>
                                                <Button
                                                    variant="text"
                                                    size="sm"
                                                    className="p-0 flex items-center justify-between w-full"
                                                >
                                                    <h4 className="text-sm font-semibold">
                                                        {t('shareTokenUsage')}
                                                    </h4>
                                                    <div>
                                                        <ChevronsUpDown className="h-4 w-4" />
                                                        <span className="sr-only">
                                                            {t('toggle')}
                                                        </span>
                                                    </div>
                                                </Button>
                                            </CollapsibleTrigger>
                                        </div>
                                        <CollapsibleContent className="space-y-2">
                                            {accessTokenId && accessToken && (
                                                <div className="space-y-2">
                                                    <div className="mx-auto">
                                                        <AccessTokenSection
                                                            tokenId={
                                                                accessTokenId
                                                            }
                                                            token={accessToken}
                                                            resourceUrl={form.getValues(
                                                                "resourceUrl"
                                                            )}
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </CollapsibleContent>
                                    </Collapsible>
                                </div>
                            )}
                        </div>
                    </CredenzaBody>
                    <CredenzaFooter>
                        <CredenzaClose asChild>
                            <Button variant="outline">{t('close')}</Button>
                        </CredenzaClose>
                        <Button
                            type="button"
                            onClick={form.handleSubmit(onSubmit)}
                            loading={loading}
                            disabled={link !== null || loading}
                        >
                            {t('createLink')}
                        </Button>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>
        </>
    );
}
