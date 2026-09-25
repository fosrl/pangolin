"use client";

import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import DomainPicker from "@app/components/DomainPicker";
import {
    PathMatchDisplay,
    PathMatchModal,
    PathRewriteDisplay,
    PathRewriteModal
} from "@app/components/PathMatchRenameModal";
import {
    SettingsContainer,
    SettingsFormCell,
    SettingsFormGrid,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionFooter,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import { SwitchInput } from "@app/components/SwitchInput";
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
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
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
import { cn } from "@app/lib/cn";
import { zodResolver } from "@hookform/resolvers/zod";
import { CaretSortIcon } from "@radix-ui/react-icons";
import { build } from "@server/build";
import type {
    CreateRedirectResponse,
    GetRedirectResponse
} from "@server/routers/redirect";
import {
    isValidDestinationHost,
    isValidRegex
} from "@server/routers/redirect/validation";
import type { AxiosResponse } from "axios";
import { InfoIcon, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ResourceSelector, type SelectedResource } from "./resource-selector";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "./ui/tooltip";
import { Alert, AlertDescription } from "./ui/alert";

const DEFAULT_PATH_MATCH_TYPE = "regex" as const;
const DEFAULT_PRIORITY = 100;

export type ExistingRedirect = GetRedirectResponse["redirect"];

type RedirectFormProps = {
    orgId: string;
    /** Omit to create a new redirect. */
    redirect?: ExistingRedirect;
    /** Name/domain of the resource the redirect is attached to, when there is one. */
    initialResource?: SelectedResource | null;
};

export default function RedirectForm({
    orgId,
    redirect,
    initialResource = null
}: RedirectFormProps) {
    const isEditing = Boolean(redirect);
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const router = useRouter();
    const t = useTranslations();

    const [, formAction, saveLoading] = useActionState(onSubmit, null);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [selectedResource, setSelectedResource] =
        useState<SelectedResource | null>(initialResource);

    // DomainPicker only hands back the composed host through its callback, so
    // keep it locally; seed from the saved redirect for the edit case.
    const [domainFullDomain, setDomainFullDomain] = useState<string | null>(
        redirect?.baseDomain
            ? [redirect.subdomain, redirect.baseDomain]
                  .filter(Boolean)
                  .join(".")
            : null
    );

    const formSchema = useMemo(
        () =>
            z
                .object({
                    name: z
                        .string()
                        .trim()
                        .min(1, { message: t("nameRequired") }),
                    attachTo: z.enum(["domain", "resource"]),
                    domainId: z.string().nullable(),
                    subdomain: z.string().nullable(),
                    resourceId: z.number().int().positive().nullable(),
                    destinationHost: z
                        .string()
                        .trim()
                        .min(1, {
                            message: t("redirectDestinationHostRequired")
                        })
                        .refine(isValidDestinationHost, {
                            message: t("redirectDestinationHostInvalid")
                        }),
                    pathMatchType: z.enum(["exact", "prefix", "regex"]),
                    matchPath: z.string().trim().nullable(),
                    rewritePath: z.string().nullable(),
                    rewritePathType: z
                        .enum(["exact", "prefix", "regex", "stripPrefix"])
                        .nullable(),
                    priority: z
                        .number()
                        .int()
                        .min(1, { message: t("redirectPriorityInvalid") })
                        .max(1000, { message: t("redirectPriorityInvalid") }),
                    permanent: z.boolean(),
                    ssl: z.boolean(),
                    enabled: z.boolean()
                })
                .superRefine((data, ctx) => {
                    if (data.attachTo === "domain" && !data.domainId) {
                        ctx.addIssue({
                            code: "custom",
                            message: t("redirectDomainRequired"),
                            path: ["domainId"]
                        });
                    }
                    if (data.attachTo === "resource" && !data.resourceId) {
                        ctx.addIssue({
                            code: "custom",
                            message: t("redirectResourceRequired"),
                            path: ["resourceId"]
                        });
                    }
                    if (
                        data.pathMatchType === "regex" &&
                        data.matchPath &&
                        !isValidRegex(data.matchPath)
                    ) {
                        ctx.addIssue({
                            code: "custom",
                            message: t("redirectMatchPathInvalidRegex"),
                            path: ["matchPath"]
                        });
                    }
                    // stripPrefix drops the matched prefix outright, so it is
                    // the one rewrite type that needs no replacement value.
                    if (
                        data.rewritePathType &&
                        data.rewritePathType !== "stripPrefix" &&
                        !data.rewritePath
                    ) {
                        ctx.addIssue({
                            code: "custom",
                            message: t("redirectRewritePathRequired"),
                            path: ["rewritePath"]
                        });
                    }
                }),
        [t]
    );

    type RedirectFormValues = z.infer<typeof formSchema>;

    const form = useForm<RedirectFormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: redirect?.name ?? "",
            attachTo: redirect?.resourceId ? "resource" : "domain",
            domainId: redirect?.domainId ?? null,
            subdomain: redirect?.subdomain ?? null,
            resourceId: redirect?.resourceId ?? null,
            destinationHost: redirect?.destinationHost ?? "",
            pathMatchType: redirect?.pathMatchType ?? DEFAULT_PATH_MATCH_TYPE,
            matchPath: redirect?.matchPath ?? null,
            rewritePath: redirect?.rewritePath ?? null,
            rewritePathType: redirect?.rewritePathType ?? null,
            priority: redirect?.priority ?? DEFAULT_PRIORITY,
            permanent: redirect?.permanent ?? false,
            ssl: redirect?.ssl ?? true,
            enabled: redirect?.enabled ?? true
        }
    });

    const attachTo = form.watch("attachTo");
    const ssl = form.watch("ssl");

    const resourceMissingDomain =
        attachTo === "resource" &&
        Boolean(selectedResource) &&
        !selectedResource?.domainId;

    const sourceFullDomain =
        attachTo === "domain"
            ? domainFullDomain
            : (selectedResource?.fullDomain ?? null);
    // Resource-attached redirects inherit the resource's ssl setting
    const sourceSsl =
        attachTo === "domain" ? ssl : (selectedResource?.ssl ?? true);
    const sourceHost = sourceFullDomain
        ? `${sourceSsl ? "https" : "http"}://${sourceFullDomain}`
        : null;

    // Mirror is UI-only state; on edit, infer it from whether the saved
    // destination already equals the source host.
    const [sameDomainAsSource, setSameDomainAsSource] = useState(
        Boolean(
            redirect && sourceHost && redirect.destinationHost === sourceHost
        )
    );

    useEffect(() => {
        if (sameDomainAsSource && sourceHost) {
            form.setValue("destinationHost", sourceHost, {
                shouldValidate: true
            });
        }
    }, [sameDomainAsSource, sourceHost, form]);
    const pathMatchType = form.watch("pathMatchType");
    const rewritePath = form.watch("rewritePath");
    const rewritePathType = form.watch("rewritePathType");
    // stripPrefix is a valid rewrite with no path value, so it counts as set.
    const hasRewrite =
        Boolean(rewritePath) || rewritePathType === "stripPrefix";

    async function onSubmit() {
        if (!(await form.trigger())) return;

        const values = form.getValues();

        // Only one of the two attachment points is ever persisted; clear the
        // other so switching between them doesn't leave a stale reference.
        const body = {
            name: values.name.trim(),
            domainId: values.attachTo === "domain" ? values.domainId : null,
            subdomain:
                values.attachTo === "domain" ? values.subdomain || null : null,
            resourceId:
                values.attachTo === "resource" ? values.resourceId : null,
            destinationHost: values.destinationHost.trim(),
            pathMatchType: values.pathMatchType,
            matchPath: values.matchPath?.trim() || null,
            rewritePath: values.rewritePath?.trim() || null,
            rewritePathType: values.rewritePathType,
            priority: values.priority,
            permanent: values.permanent,
            // Resource-attached redirects inherit the resource's ssl setting
            ssl: values.attachTo === "domain" ? values.ssl : true,
            enabled: values.enabled
        };

        try {
            if (isEditing) {
                await api.post(
                    `/org/${orgId}/redirects/${redirect!.redirectId}`,
                    body
                );
                toast({
                    title: t("success"),
                    description: t("redirectUpdated")
                });
            } else {
                const res = await api.put<
                    AxiosResponse<CreateRedirectResponse>
                >(`/org/${orgId}/redirect`, body);
                toast({
                    title: t("success"),
                    description: t("redirectCreated")
                });
            }
            router.push(`/${orgId}/settings/redirects/`);
        } catch (e) {
            toast({
                variant: "destructive",
                title: isEditing
                    ? t("redirectErrorUpdate")
                    : t("redirectErrorCreate"),
                description: formatAxiosError(
                    e,
                    isEditing
                        ? t("redirectErrorUpdate")
                        : t("redirectErrorCreate")
                )
            });
        }
    }

    async function onDelete() {
        setDeleteLoading(true);
        try {
            await api.delete(`/org/${orgId}/redirects/${redirect!.redirectId}`);
            toast({
                title: t("success"),
                description: t("redirectDeleted")
            });
            router.push(`/${orgId}/settings/redirects`);
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("redirectErrorDelete"),
                description: formatAxiosError(e, t("redirectErrorDelete"))
            });
        } finally {
            setDeleteLoading(false);
            setIsDeleteModalOpen(false);
        }
    }

    return (
        <>
            {isEditing && (
                <ConfirmDeleteDialog
                    open={isDeleteModalOpen}
                    setOpen={setIsDeleteModalOpen}
                    dialog={
                        <div className="space-y-2">
                            <p>{t("redirectQuestionRemove")}</p>
                            <p>{t("redirectMessageRemove")}</p>
                        </div>
                    }
                    buttonText={t("redirectDeleteConfirm")}
                    onConfirm={onDelete}
                    string={redirect!.name}
                    title={t("redirectDelete")}
                />
            )}

            <SettingsContainer>
                <SettingsSection className="pb-10">
                    <SettingsSectionHeader>
                        <SettingsSectionTitle>
                            {t("redirectSource")}
                        </SettingsSectionTitle>
                        <SettingsSectionDescription>
                            {t("redirectSourceSectionDescription")}
                        </SettingsSectionDescription>
                    </SettingsSectionHeader>

                    <SettingsSectionBody>
                        <SettingsSectionForm variant="half">
                            <Form {...form}>
                                <form action={formAction} id="redirect-form">
                                    <SettingsFormGrid>
                                        <SettingsFormCell
                                            span="full"
                                            className="flex flex-col items-start gap-4"
                                        >
                                            {resourceMissingDomain && (
                                                <Alert variant="neutral">
                                                    <InfoIcon className="h-4 w-4" />
                                                    <AlertDescription>
                                                        {t(
                                                            "redirectDomainSelectedDomainNotFound"
                                                        )}
                                                    </AlertDescription>
                                                </Alert>
                                            )}
                                            <FormField
                                                control={form.control}
                                                name="enabled"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormControl>
                                                            <SwitchInput
                                                                id="redirect-enabled"
                                                                label={t(
                                                                    "enabled"
                                                                )}
                                                                description={t(
                                                                    "redirectEnabledDescription"
                                                                )}
                                                                checked={
                                                                    !resourceMissingDomain &&
                                                                    field.value
                                                                }
                                                                disabled={
                                                                    resourceMissingDomain
                                                                }
                                                                onCheckedChange={
                                                                    field.onChange
                                                                }
                                                            />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </SettingsFormCell>

                                        <SettingsFormCell span="full">
                                            <FormField
                                                control={form.control}
                                                name="name"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t("name")}
                                                        </FormLabel>
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
                                        </SettingsFormCell>

                                        <SettingsFormCell span="half">
                                            <FormField
                                                control={form.control}
                                                name="attachTo"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t(
                                                                "redirectAttachedTo"
                                                            )}
                                                        </FormLabel>
                                                        <Select
                                                            value={field.value}
                                                            onValueChange={
                                                                field.onChange
                                                            }
                                                        >
                                                            <FormControl>
                                                                <SelectTrigger>
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent>
                                                                <SelectItem value="domain">
                                                                    {t(
                                                                        "redirectAttachDomain"
                                                                    )}
                                                                </SelectItem>
                                                                <SelectItem value="resource">
                                                                    {t(
                                                                        "redirectAttachResource"
                                                                    )}
                                                                </SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                        <FormDescription>
                                                            {t(
                                                                "redirectAttachedToDescription"
                                                            )}
                                                        </FormDescription>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </SettingsFormCell>
                                        {attachTo === "domain" ? (
                                            <SettingsFormCell span="full">
                                                <FormField
                                                    control={form.control}
                                                    name="domainId"
                                                    render={() => (
                                                        <FormItem>
                                                            <DomainPicker
                                                                orgId={orgId}
                                                                cols={1}
                                                                hideFreeDomain
                                                                defaultDomainId={
                                                                    redirect?.domainId
                                                                }
                                                                allowWildcard
                                                                defaultSubdomain={
                                                                    redirect?.subdomain
                                                                }
                                                                onDomainChange={(
                                                                    res
                                                                ) => {
                                                                    form.setValue(
                                                                        "domainId",
                                                                        res?.domainId ??
                                                                            null,
                                                                        {
                                                                            shouldValidate: true
                                                                        }
                                                                    );
                                                                    form.setValue(
                                                                        "subdomain",
                                                                        res?.subdomain ||
                                                                            null
                                                                    );
                                                                    setDomainFullDomain(
                                                                        res?.fullDomain ??
                                                                            null
                                                                    );
                                                                }}
                                                            />
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            </SettingsFormCell>
                                        ) : (
                                            <SettingsFormCell span="half">
                                                <FormField
                                                    control={form.control}
                                                    name="resourceId"
                                                    render={({ field }) => (
                                                        <FormItem className="flex flex-col">
                                                            <FormLabel>
                                                                {t(
                                                                    "selectedRedirectResource"
                                                                )}
                                                            </FormLabel>
                                                            <Popover>
                                                                <PopoverTrigger
                                                                    asChild
                                                                >
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
                                                                            {selectedResource?.name ??
                                                                                t(
                                                                                    "resourceSelect"
                                                                                )}
                                                                            <CaretSortIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                                        </Button>
                                                                    </FormControl>
                                                                </PopoverTrigger>
                                                                <PopoverContent className="p-0">
                                                                    <ResourceSelector
                                                                        orgId={
                                                                            orgId
                                                                        }
                                                                        selectedResource={
                                                                            selectedResource
                                                                        }
                                                                        onSelectResource={(
                                                                            resource
                                                                        ) => {
                                                                            setSelectedResource(
                                                                                resource
                                                                            );
                                                                            field.onChange(
                                                                                resource.resourceId
                                                                            );
                                                                        }}
                                                                    />
                                                                </PopoverContent>
                                                            </Popover>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            </SettingsFormCell>
                                        )}

                                        {attachTo === "resource" && (
                                            <SettingsFormCell span="full">
                                                <FormItem>
                                                    <FormLabel>
                                                        {t("resourceDomain")}
                                                    </FormLabel>
                                                    <Input
                                                        disabled
                                                        readOnly
                                                        value={
                                                            selectedResource?.fullDomain ??
                                                            ""
                                                        }
                                                        placeholder={
                                                            selectedResource
                                                                ? t(
                                                                      "redirectResourceNoDomain"
                                                                  )
                                                                : t(
                                                                      "resourceSelect"
                                                                  )
                                                        }
                                                    />
                                                </FormItem>
                                            </SettingsFormCell>
                                        )}

                                        {/* The cloud only serves HTTPS, so there is nothing to toggle there. */}
                                        {build !== "saas" && (
                                            <SettingsFormCell span="full">
                                                <FormField
                                                    control={form.control}
                                                    name="ssl"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormControl>
                                                                <SwitchInput
                                                                    id="redirect-ssl"
                                                                    label={t(
                                                                        "proxyEnableSSL"
                                                                    )}
                                                                    description={
                                                                        attachTo ===
                                                                        "resource"
                                                                            ? t(
                                                                                  "redirectSslInheritedDescription"
                                                                              )
                                                                            : t(
                                                                                  "redirectSslDescription"
                                                                              )
                                                                    }
                                                                    disabled={
                                                                        attachTo ===
                                                                        "resource"
                                                                    }
                                                                    checked={
                                                                        attachTo ===
                                                                        "resource"
                                                                            ? (selectedResource?.ssl ??
                                                                              true)
                                                                            : field.value
                                                                    }
                                                                    onCheckedChange={
                                                                        field.onChange
                                                                    }
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            </SettingsFormCell>
                                        )}
                                    </SettingsFormGrid>
                                </form>
                            </Form>
                        </SettingsSectionForm>
                    </SettingsSectionBody>
                </SettingsSection>

                <SettingsSection className="pb-10">
                    <SettingsSectionHeader>
                        <SettingsSectionTitle>
                            {t("redirectSettings")}
                        </SettingsSectionTitle>
                        <SettingsSectionDescription>
                            {t("redirectSettingsDescription")}
                        </SettingsSectionDescription>
                    </SettingsSectionHeader>

                    <SettingsSectionBody>
                        <SettingsSectionForm variant="half">
                            <Form {...form}>
                                <form action={formAction}>
                                    <SettingsFormGrid>
                                        <SettingsFormCell span="full">
                                            <SwitchInput
                                                id="redirect-same-domain"
                                                label={t(
                                                    "redirectSameDomainAsSource"
                                                )}
                                                description={t(
                                                    "redirectSameDomainAsSourceDescription"
                                                )}
                                                checked={sameDomainAsSource}
                                                onCheckedChange={
                                                    setSameDomainAsSource
                                                }
                                            />
                                        </SettingsFormCell>

                                        <SettingsFormCell span="full">
                                            <FormField
                                                control={form.control}
                                                name="destinationHost"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t(
                                                                "redirectDestinationHost"
                                                            )}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                autoComplete="off"
                                                                placeholder="https://example.com"
                                                                readOnly={
                                                                    sameDomainAsSource
                                                                }
                                                                {...field}
                                                            />
                                                        </FormControl>
                                                        <FormDescription>
                                                            {t(
                                                                "redirectDestinationHostDescription"
                                                            )}
                                                        </FormDescription>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </SettingsFormCell>

                                        <SettingsFormCell span="half">
                                            <FormField
                                                control={form.control}
                                                name="matchPath"
                                                render={({ field }) => (
                                                    <FormItem className="flex flex-col">
                                                        <FormLabel>
                                                            {t("matchPath")}
                                                        </FormLabel>
                                                        <PathMatchModal
                                                            value={{
                                                                path: field.value,
                                                                pathMatchType:
                                                                    pathMatchType
                                                            }}
                                                            onChange={(
                                                                config
                                                            ) => {
                                                                // No match path
                                                                // means the
                                                                // redirect applies
                                                                // to every path;
                                                                // pathMatchType is
                                                                // NOT NULL so it
                                                                // keeps a default.
                                                                field.onChange(
                                                                    config.path ||
                                                                        null
                                                                );
                                                                form.setValue(
                                                                    "pathMatchType",
                                                                    (config.pathMatchType as
                                                                        | "exact"
                                                                        | "prefix"
                                                                        | "regex") ||
                                                                        DEFAULT_PATH_MATCH_TYPE
                                                                );
                                                            }}
                                                            trigger={
                                                                <Button
                                                                    type="button"
                                                                    variant="outline"
                                                                    className="flex items-center gap-2 p-2 w-full text-left cursor-pointer"
                                                                >
                                                                    {field.value ? (
                                                                        <PathMatchDisplay
                                                                            value={{
                                                                                path: field.value,
                                                                                pathMatchType:
                                                                                    pathMatchType
                                                                            }}
                                                                        />
                                                                    ) : (
                                                                        <>
                                                                            <Plus className="h-4 w-4" />
                                                                            {t(
                                                                                "matchPath"
                                                                            )}
                                                                        </>
                                                                    )}
                                                                </Button>
                                                            }
                                                        />
                                                        <FormDescription>
                                                            {t(
                                                                "redirectMatchPathDescription"
                                                            )}
                                                        </FormDescription>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </SettingsFormCell>

                                        <SettingsFormCell span="half">
                                            <FormField
                                                control={form.control}
                                                name="rewritePath"
                                                render={({ field }) => (
                                                    <FormItem className="flex flex-col">
                                                        <FormLabel>
                                                            {t("rewritePath")}
                                                        </FormLabel>
                                                        <PathRewriteModal
                                                            value={{
                                                                rewritePath:
                                                                    field.value,
                                                                rewritePathType:
                                                                    rewritePathType
                                                            }}
                                                            onChange={(
                                                                config
                                                            ) => {
                                                                field.onChange(
                                                                    config.rewritePath ||
                                                                        null
                                                                );
                                                                form.setValue(
                                                                    "rewritePathType",
                                                                    (config.rewritePathType as
                                                                        | "exact"
                                                                        | "prefix"
                                                                        | "regex"
                                                                        | "stripPrefix"
                                                                        | null) ??
                                                                        null
                                                                );
                                                            }}
                                                            trigger={
                                                                hasRewrite ? (
                                                                    <Button
                                                                        type="button"
                                                                        variant="outline"
                                                                        className="flex items-center gap-2 p-2 w-full text-left cursor-pointer"
                                                                    >
                                                                        <PathRewriteDisplay
                                                                            value={{
                                                                                rewritePath:
                                                                                    field.value,
                                                                                rewritePathType:
                                                                                    rewritePathType
                                                                            }}
                                                                        />
                                                                    </Button>
                                                                ) : (
                                                                    <Button
                                                                        type="button"
                                                                        variant="outline"
                                                                        className="w-full"
                                                                    >
                                                                        <Plus className="h-4 w-4 mr-2" />
                                                                        {t(
                                                                            "rewritePath"
                                                                        )}
                                                                    </Button>
                                                                )
                                                            }
                                                        />
                                                        <FormDescription>
                                                            {t(
                                                                "redirectRewritePathDescription"
                                                            )}
                                                        </FormDescription>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </SettingsFormCell>

                                        <SettingsFormCell span="half">
                                            <FormField
                                                control={form.control}
                                                name="priority"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t("priority")}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                type="number"
                                                                min={1}
                                                                max={1000}
                                                                {...field}
                                                                onChange={(e) =>
                                                                    field.onChange(
                                                                        e.target
                                                                            .valueAsNumber
                                                                    )
                                                                }
                                                            />
                                                        </FormControl>
                                                        <FormDescription>
                                                            {t(
                                                                "redirectPriorityDescription"
                                                            )}
                                                        </FormDescription>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </SettingsFormCell>

                                        <SettingsFormCell span="full">
                                            <FormField
                                                control={form.control}
                                                name="permanent"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormControl>
                                                            <SwitchInput
                                                                id="redirect-permanent"
                                                                label={t(
                                                                    "redirectPermanent"
                                                                )}
                                                                description={t(
                                                                    "redirectPermanentDescription"
                                                                )}
                                                                checked={
                                                                    field.value
                                                                }
                                                                onCheckedChange={
                                                                    field.onChange
                                                                }
                                                            />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </SettingsFormCell>
                                    </SettingsFormGrid>
                                </form>
                            </Form>
                        </SettingsSectionForm>
                    </SettingsSectionBody>
                </SettingsSection>

                {isEditing && (
                    <SettingsSection>
                        <SettingsSectionHeader>
                            <SettingsSectionTitle>
                                {t("dangerSection")}
                            </SettingsSectionTitle>
                        </SettingsSectionHeader>
                        <SettingsSectionFooter>
                            <Button
                                variant="destructive"
                                onClick={() => setIsDeleteModalOpen(true)}
                                loading={deleteLoading}
                                disabled={deleteLoading}
                            >
                                {t("redirectDelete")}
                            </Button>
                        </SettingsSectionFooter>
                    </SettingsSection>
                )}

                <div className="flex justify-end space-x-2 mt-8">
                    <Button type="button" variant="outline" asChild>
                        <Link href={`/${orgId}/settings/redirects`}>
                            {t("cancel")}
                        </Link>
                    </Button>
                    <Button
                        type="submit"
                        form="redirect-form"
                        loading={saveLoading}
                        disabled={saveLoading}
                    >
                        {isEditing ? t("saveSettings") : t("redirectAdd")}
                    </Button>
                </div>
            </SettingsContainer>
        </>
    );
}
