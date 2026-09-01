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
import { type TagValue } from "@app/components/multi-select/multi-select-content";
import { MultiSelectTagInput } from "@app/components/multi-select/multi-select-tag-input";
import { Button } from "@app/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@app/components/ui/dropdown-menu";
import { Switch } from "@app/components/ui/switch";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@app/components/ui/select";
import { cn } from "@app/lib/cn";
import { aiProviderQueries } from "@app/lib/queries";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Plus, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

export type AiProviderAttachmentValue = {
    providerId: number;
    niceId: string;
    name: string;
    accessMode: "inherit" | "select";
    enabled: boolean;
    selectedModelIds: number[];
};

export type AiProviderAttachmentsProps = {
    orgId: string;
    value: AiProviderAttachmentValue[];
    onChange: (value: AiProviderAttachmentValue[]) => void;
    disabled?: boolean;
};

export function AiProviderAttachments({
    orgId,
    value,
    onChange,
    disabled
}: AiProviderAttachmentsProps) {
    const t = useTranslations();
    const [editingProviderId, setEditingProviderId] = useState<number | null>(
        null
    );

    const { data: providers = [] } = useQuery(
        aiProviderQueries.orgProviders({ orgId })
    );

    const attachedIds = useMemo(
        () => new Set(value.map((v) => v.providerId)),
        [value]
    );

    const availableProviders = providers
        .filter((provider) => provider.enabled)
        .filter((provider) => !attachedIds.has(provider.providerId));

    const editing = value.find((v) => v.providerId === editingProviderId);

    function addProvider(providerId: number, niceId: string, name: string) {
        if (value.some((v) => v.providerId === providerId)) {
            return;
        }
        onChange([
            ...value,
            {
                providerId,
                niceId,
                name,
                accessMode: "inherit",
                enabled: true,
                selectedModelIds: []
            }
        ]);
    }

    function removeProvider(providerId: number) {
        onChange(value.filter((v) => v.providerId !== providerId));
    }

    function updateProvider(updated: AiProviderAttachmentValue) {
        onChange(
            value.map((v) =>
                v.providerId === updated.providerId ? updated : v
            )
        );
        setEditingProviderId(null);
    }

    return (
        <div className="flex flex-col gap-3">
            {value.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                    {t("aiResourceProvidersNoneAttached")}
                </p>
            ) : (
                <div className="flex flex-col gap-2">
                    {value.map((attachment) => (
                        <AttachmentRow
                            key={attachment.providerId}
                            attachment={attachment}
                            disabled={disabled}
                            onEdit={() =>
                                setEditingProviderId(attachment.providerId)
                            }
                            onRemove={() =>
                                removeProvider(attachment.providerId)
                            }
                            onToggleEnabled={(enabled) => {
                                onChange(
                                    value.map((v) =>
                                        v.providerId === attachment.providerId
                                            ? { ...v, enabled }
                                            : v
                                    )
                                );
                            }}
                        />
                    ))}
                </div>
            )}

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-fit"
                        disabled={disabled || availableProviders.length === 0}
                    >
                        <Plus className="size-4" />
                        {t("aiResourceProvidersAdd")}
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                    {availableProviders.map((provider) => (
                        <DropdownMenuItem
                            key={provider.providerId}
                            onSelect={() =>
                                addProvider(
                                    provider.providerId,
                                    provider.niceId,
                                    provider.name
                                )
                            }
                        >
                            {provider.name}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>

            {editing && (
                <EditAttachmentCredenza
                    orgId={orgId}
                    attachment={editing}
                    open={editingProviderId !== null}
                    onOpenChange={(open) => {
                        if (!open) setEditingProviderId(null);
                    }}
                    onSave={updateProvider}
                />
            )}
        </div>
    );
}

function AttachmentRow({
    attachment,
    disabled,
    onEdit,
    onRemove,
    onToggleEnabled
}: {
    attachment: AiProviderAttachmentValue;
    disabled?: boolean;
    onEdit: () => void;
    onRemove: () => void;
    onToggleEnabled: (enabled: boolean) => void;
}) {
    const t = useTranslations();
    const summary =
        attachment.accessMode === "inherit"
            ? t("aiResourceProviderModeInherit")
            : t("aiResourceProviderModeSelectSummary", {
                  count: attachment.selectedModelIds.length
              });

    return (
        <div
            className={cn(
                "flex items-center gap-3 rounded-md border border-input p-3 min-w-0",
                (disabled || !attachment.enabled) && "opacity-60",
                !disabled && "cursor-pointer hover:bg-muted/50"
            )}
            onClick={disabled ? undefined : onEdit}
            onKeyDown={
                disabled
                    ? undefined
                    : (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onEdit();
                          }
                      }
            }
            role={disabled ? undefined : "button"}
            tabIndex={disabled ? undefined : 0}
        >
            <div className="flex flex-1 min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium truncate">
                    {attachment.name}
                </span>
                <p className="truncate text-sm text-muted-foreground">
                    {attachment.enabled
                        ? summary
                        : t("aiResourceProviderDisabled")}
                </p>
            </div>
            <div
                className="flex shrink-0 items-center gap-2"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
            >
                <Button
                    type="button"
                    variant="text"
                    size="sm"
                    className="h-auto px-0"
                    disabled={disabled}
                    onClick={onEdit}
                >
                    {t("edit")}
                </Button>
                <button
                    type="button"
                    className="p-0.5 text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-50"
                    disabled={disabled}
                    aria-label={t("aiResourceProvidersRemove")}
                    onClick={onRemove}
                >
                    <XIcon className="size-4" />
                </button>
                <Switch
                    checked={attachment.enabled}
                    disabled={disabled}
                    aria-label={t("aiResourceProviderToggleEnabled")}
                    onCheckedChange={onToggleEnabled}
                />
            </div>
        </div>
    );
}

type EditFormValues = {
    accessMode: "inherit" | "select";
    selectedModels: TagValue[];
};

function EditAttachmentCredenza({
    orgId,
    attachment,
    open,
    onOpenChange,
    onSave
}: {
    orgId: string;
    attachment: AiProviderAttachmentValue;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (value: AiProviderAttachmentValue) => void;
}) {
    const t = useTranslations();
    const [modelSearch, setModelSearch] = useState("");

    const editSchema = useMemo(
        () =>
            z.object({
                accessMode: z.enum(["inherit", "select"]),
                selectedModels: z.array(
                    z.object({
                        id: z.string(),
                        text: z.string()
                    })
                )
            }),
        []
    );

    const modelsQuery = useQuery({
        ...aiProviderQueries.providerModels({
            providerId: attachment.providerId
        }),
        enabled: open
    });

    const allowCatalog = useMemo(() => {
        const models = modelsQuery.data ?? [];
        return models.filter(
            (model) => model.enabled && (model.listType ?? "allow") === "allow"
        );
    }, [modelsQuery.data]);

    const allowOptions: TagValue[] = useMemo(() => {
        const query = modelSearch.trim().toLowerCase();
        return allowCatalog
            .filter((model) => {
                if (!query) return true;
                return (
                    model.modelKey.toLowerCase().includes(query) ||
                    model.name.toLowerCase().includes(query)
                );
            })
            .map((model) => ({
                id: String(model.modelId),
                text: model.modelKey
            }));
    }, [allowCatalog, modelSearch]);

    const form = useForm<EditFormValues>({
        resolver: zodResolver(editSchema),
        defaultValues: {
            accessMode: attachment.accessMode,
            selectedModels: []
        }
    });

    const accessMode = form.watch("accessMode");
    const pendingSeedRef = useRef(false);

    useEffect(() => {
        if (!open) return;
        form.reset({
            accessMode: attachment.accessMode,
            selectedModels: attachment.selectedModelIds.map((modelId) => {
                const catalog = (modelsQuery.data ?? []).find(
                    (model) => model.modelId === modelId
                );
                return {
                    id: String(modelId),
                    text: catalog?.modelKey ?? String(modelId)
                };
            })
        });
        setModelSearch("");
        pendingSeedRef.current = false;
        // Only re-init when opening or switching which attachment is edited.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, attachment.providerId]);

    useEffect(() => {
        if (!open || allowCatalog.length === 0) return;

        const current = form.getValues("selectedModels");
        const upgraded = current.map((model) => {
            const catalog = allowCatalog.find(
                (entry) => String(entry.modelId) === model.id
            );
            return catalog ? { id: model.id, text: catalog.modelKey } : model;
        });
        const changed = upgraded.some(
            (model, index) => model.text !== current[index]?.text
        );
        if (changed) {
            form.setValue("selectedModels", upgraded);
        }

        if (pendingSeedRef.current) {
            form.setValue(
                "selectedModels",
                allowCatalog.map((model) => ({
                    id: String(model.modelId),
                    text: model.modelKey
                }))
            );
            pendingSeedRef.current = false;
        }
    }, [open, allowCatalog, form]);

    function handleAccessModeChange(next: "inherit" | "select") {
        form.setValue("accessMode", next);
        if (next === "inherit") {
            form.setValue("selectedModels", []);
            pendingSeedRef.current = false;
            return;
        }
        if (attachment.accessMode === "select") {
            form.setValue(
                "selectedModels",
                attachment.selectedModelIds.map((modelId) => {
                    const catalog = allowCatalog.find(
                        (model) => model.modelId === modelId
                    );
                    return {
                        id: String(modelId),
                        text: catalog?.modelKey ?? String(modelId)
                    };
                })
            );
            pendingSeedRef.current = false;
            return;
        }
        if (allowCatalog.length > 0) {
            form.setValue(
                "selectedModels",
                allowCatalog.map((model) => ({
                    id: String(model.modelId),
                    text: model.modelKey
                }))
            );
            pendingSeedRef.current = false;
            return;
        }
        form.setValue("selectedModels", []);
        pendingSeedRef.current = true;
    }

    function onSubmit(values: EditFormValues) {
        onSave({
            providerId: attachment.providerId,
            niceId: attachment.niceId,
            name: attachment.name,
            accessMode: values.accessMode,
            enabled: attachment.enabled,
            selectedModelIds:
                values.accessMode === "select"
                    ? values.selectedModels.map((model) =>
                          parseInt(model.id, 10)
                      )
                    : []
        });
    }

    return (
        <Credenza open={open} onOpenChange={onOpenChange}>
            <CredenzaContent>
                <CredenzaHeader>
                    <CredenzaTitle>{attachment.name}</CredenzaTitle>
                    <CredenzaDescription>
                        {t("aiResourceProviderEditDescription")}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                    <Form {...form}>
                        <form
                            id="ai-provider-attachment-edit-form"
                            className="space-y-4"
                            onSubmit={form.handleSubmit(onSubmit)}
                        >
                            <FormField
                                control={form.control}
                                name="accessMode"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>
                                            {t("aiResourceProviderMode")}
                                        </FormLabel>
                                        <Select
                                            value={field.value}
                                            onValueChange={(value) =>
                                                handleAccessModeChange(
                                                    value as
                                                        | "inherit"
                                                        | "select"
                                                )
                                            }
                                        >
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="inherit">
                                                    {t(
                                                        "aiResourceProviderModeInherit"
                                                    )}
                                                </SelectItem>
                                                <SelectItem value="select">
                                                    {t(
                                                        "aiResourceProviderModeSelect"
                                                    )}
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <FormDescription>
                                            {field.value === "inherit"
                                                ? t(
                                                      "aiResourceProviderModeInheritHelp"
                                                  )
                                                : t(
                                                      "aiResourceProviderModeSelectHelp"
                                                  )}
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {accessMode === "select" && (
                                <FormField
                                    control={form.control}
                                    name="selectedModels"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>
                                                {t(
                                                    "aiResourceProviderAllowModels"
                                                )}
                                            </FormLabel>
                                            <FormControl>
                                                <MultiSelectTagInput
                                                    buttonText={t(
                                                        "aiResourceProviderAllowModelsSelect"
                                                    )}
                                                    emptyPlaceholder={t(
                                                        "aiResourceProviderAllowModelsEmpty"
                                                    )}
                                                    searchPlaceholder={t(
                                                        "aiResourceProviderAllowModelsSearch"
                                                    )}
                                                    searchQuery={modelSearch}
                                                    options={allowOptions}
                                                    value={field.value}
                                                    onChange={field.onChange}
                                                    onSearch={setModelSearch}
                                                    disabled={
                                                        modelsQuery.isLoading
                                                    }
                                                />
                                            </FormControl>
                                            <FormDescription>
                                                {t(
                                                    "aiResourceProviderAllowModelsHelp"
                                                )}
                                            </FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            )}
                        </form>
                    </Form>
                </CredenzaBody>
                <CredenzaFooter>
                    <Button
                        variant="link"
                        size="sm"
                        className="mr-auto px-0"
                        asChild
                    >
                        <Link
                            href={`/${orgId}/settings/ai-providers/${attachment.niceId}`}
                        >
                            {t("viewProviderSettings")}
                        </Link>
                    </Button>
                    <CredenzaClose asChild>
                        <Button variant="outline">{t("close")}</Button>
                    </CredenzaClose>
                    <Button
                        type="submit"
                        form="ai-provider-attachment-edit-form"
                    >
                        {t("done")}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
