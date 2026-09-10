"use client";

import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
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
import { orgQueries } from "@app/lib/queries";
import { CaretSortIcon } from "@radix-ui/react-icons";
import { zodResolver } from "@hookform/resolvers/zod";
import type {
    CreateRedirectResponse,
    GetRedirectResponse
} from "@server/routers/redirect";
import type { AxiosResponse } from "axios";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ResourceSelector, type SelectedResource } from "./resource-selector";
import {
    PathMatchDisplay,
    PathMatchModal,
    PathRewriteDisplay,
    PathRewriteModal
} from "@app/components/PathMatchRenameModal";
import { Plus } from "lucide-react";
import Link from "next/link";

const DEFAULT_MATCH_PATH = "*";
const DEFAULT_PATH_MATCH_TYPE = "regex" as const;

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

    const [saveLoading, setSaveLoading] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [selectedResource, setSelectedResource] =
        useState<SelectedResource | null>(initialResource);

    const { data: domains = [] } = useQuery(orgQueries.domains({ orgId }));

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
                    resourceId: z.number().int().positive().nullable(),
                    destinationDomain: z
                        .string()
                        .trim()
                        .min(1, {
                            message: t("redirectDestinationDomainRequired")
                        }),
                    pathMatchType: z.enum(["exact", "prefix", "regex"]),
                    matchPath: z.string().trim().min(1),
                    rewritePath: z.string().nullable(),
                    rewritePathType: z
                        .enum(["exact", "prefix", "regex", "stripPrefix"])
                        .nullable(),
                    permanent: z.boolean(),
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
            resourceId: redirect?.resourceId ?? null,
            destinationDomain: redirect?.destinationDomain ?? "",
            pathMatchType: redirect?.pathMatchType ?? DEFAULT_PATH_MATCH_TYPE,
            matchPath: redirect?.matchPath ?? DEFAULT_MATCH_PATH,
            rewritePath: redirect?.rewritePath ?? null,
            rewritePathType: redirect?.rewritePathType ?? null,
            permanent: redirect?.permanent ?? false,
            enabled: redirect?.enabled ?? true
        }
    });

    const attachTo = form.watch("attachTo");
    const pathMatchType = form.watch("pathMatchType");
    const rewritePath = form.watch("rewritePath");
    const rewritePathType = form.watch("rewritePathType");
    // stripPrefix is a valid rewrite with no path value, so it counts as set.
    const hasRewrite =
        Boolean(rewritePath) || rewritePathType === "stripPrefix";

    async function onSubmit(values: RedirectFormValues) {
        setSaveLoading(true);

        // Only one of the two attachment points is ever persisted; clear the
        // other so switching between them doesn't leave a stale reference.
        const body = {
            name: values.name.trim(),
            domainId: values.attachTo === "domain" ? values.domainId : null,
            resourceId:
                values.attachTo === "resource" ? values.resourceId : null,
            destinationDomain: values.destinationDomain.trim(),
            pathMatchType: values.pathMatchType,
            matchPath: values.matchPath.trim(),
            rewritePath: values.rewritePath?.trim() || null,
            rewritePathType: values.rewritePathType,
            permanent: values.permanent,
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
                router.refresh();
            } else {
                const res = await api.put<
                    AxiosResponse<CreateRedirectResponse>
                >(`/org/${orgId}/redirect`, body);
                toast({
                    title: t("success"),
                    description: t("redirectCreated")
                });
                router.push(
                    `/${orgId}/settings/redirects/${res.data.data.redirect.niceId}`
                );
            }
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
        } finally {
            setSaveLoading(false);
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
                <SettingsSection>
                    <SettingsSectionHeader>
                        <SettingsSectionTitle>
                            {t("general")}
                        </SettingsSectionTitle>
                        <SettingsSectionDescription>
                            {t("redirectSettingsGeneralDescription")}
                        </SettingsSectionDescription>
                    </SettingsSectionHeader>

                    <SettingsSectionBody>
                        <SettingsSectionForm variant="half">
                            <Form {...form}>
                                <form
                                    onSubmit={form.handleSubmit(onSubmit)}
                                    id="redirect-form"
                                >
                                    <SettingsFormGrid>
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
                                            <SettingsFormCell span="half">
                                                <FormField
                                                    control={form.control}
                                                    name="domainId"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel>
                                                                {t(
                                                                    "selectedRedirectDomain"
                                                                )}
                                                            </FormLabel>
                                                            <Select
                                                                value={
                                                                    field.value ??
                                                                    undefined
                                                                }
                                                                onValueChange={
                                                                    field.onChange
                                                                }
                                                            >
                                                                <FormControl>
                                                                    <SelectTrigger>
                                                                        <SelectValue
                                                                            placeholder={t(
                                                                                "redirectDomainSelect"
                                                                            )}
                                                                        />
                                                                    </SelectTrigger>
                                                                </FormControl>
                                                                <SelectContent>
                                                                    {domains.map(
                                                                        (
                                                                            domain
                                                                        ) => (
                                                                            <SelectItem
                                                                                key={
                                                                                    domain.domainId
                                                                                }
                                                                                value={
                                                                                    domain.domainId
                                                                                }
                                                                            >
                                                                                {
                                                                                    domain.baseDomain
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
                                    </SettingsFormGrid>
                                </form>
                            </Form>
                        </SettingsSectionForm>
                    </SettingsSectionBody>
                </SettingsSection>

                <SettingsSection>
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
                                <form
                                    onSubmit={form.handleSubmit(onSubmit)}
                                    id="redirect-form"
                                >
                                    <SettingsFormGrid>
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
                                                name="destinationDomain"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t(
                                                                "redirectDestinationDomain"
                                                            )}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                autoComplete="off"
                                                                placeholder="example.com"
                                                                {...field}
                                                            />
                                                        </FormControl>
                                                        <FormDescription>
                                                            {t(
                                                                "redirectDestinationDomainDescription"
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
                                                                // matchPath and
                                                                // pathMatchType are
                                                                // NOT NULL, so a
                                                                // clear falls back
                                                                // to the defaults
                                                                // rather than null.
                                                                field.onChange(
                                                                    config.path ||
                                                                        DEFAULT_MATCH_PATH
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
                                                                    <PathMatchDisplay
                                                                        value={{
                                                                            path: field.value,
                                                                            pathMatchType:
                                                                                pathMatchType
                                                                        }}
                                                                    />
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
                            <SettingsSectionDescription>
                                {t("redirectDangerSectionDescription")}
                            </SettingsSectionDescription>
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
