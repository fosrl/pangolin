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
import { Button } from "@app/components/ui/button";
import { Checkbox } from "@app/components/ui/checkbox";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList
} from "@app/components/ui/command";
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
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
import { cn } from "@app/lib/cn";
import { isModelKeyPattern } from "@server/lib/aiModelKeyMatch";
import { HorizontalTabs } from "@app/components/HorizontalTabs";
import {
    BudgetRowsFields,
    getBudgetRowsErrors,
    rowsFromBudgets,
    saveBudgetRows,
    type BudgetRow
} from "@app/components/BudgetsEditor";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { aiBudgetQueries } from "@app/lib/queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import type { AxiosInstance } from "axios";
import { Globe, Plus, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

export type ModelListType = "allow" | "block";
export type ModelSource = "catalog" | "custom" | "pattern" | "all";

/** Matches every model key via the provider policy wildcard. */
export const ALL_MODELS_KEY = "*";

const COLLAPSED_ROWS = 5;
const GRID_COLUMNS = 2;

export type AiProviderModelListItem = {
    clientId: string;
    modelId?: number;
    modelKey: string;
    listType: ModelListType;
    hasBudget?: boolean;
    pendingBudgets?: BudgetRow[];
};

export async function persistPendingModelBudgets({
    api,
    orgId,
    modelId,
    pendingBudgets
}: {
    api: AxiosInstance;
    orgId: string;
    modelId: number;
    pendingBudgets?: BudgetRow[];
}): Promise<void> {
    if (!pendingBudgets || pendingBudgets.length === 0) {
        return;
    }
    await saveBudgetRows({
        api,
        orgId,
        scope: { type: "model", id: modelId },
        existingBudgets: [],
        rows: pendingBudgets
    });
}

export type AiProviderModelListEditorProps = {
    orgId: string;
    listType: ModelListType;
    items: AiProviderModelListItem[];
    catalogModels: string[];
    /** Keys already used on this list or the sibling list. */
    excludeKeys?: ReadonlySet<string>;
    onChange: (items: AiProviderModelListItem[]) => void;
    disabled?: boolean;
    emptyMessage: string;
    addPlaceholder: string;
};

export function isAllModelsKey(modelKey: string): boolean {
    return modelKey.trim() === ALL_MODELS_KEY;
}

export function resolveModelSource(
    modelKey: string,
    catalogModels: ReadonlySet<string> | readonly string[]
): ModelSource {
    if (isAllModelsKey(modelKey)) {
        return "all";
    }
    if (isModelKeyPattern(modelKey)) {
        return "pattern";
    }
    const set =
        catalogModels instanceof Set ? catalogModels : new Set(catalogModels);
    return set.has(modelKey) ? "catalog" : "custom";
}

function newClientId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function parseBulkKeys(raw: string): string[] {
    const seen = new Set<string>();
    const keys: string[] = [];
    for (const part of raw.split(/[\n,]+/)) {
        const key = part.trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        keys.push(key);
    }
    return keys;
}

export function AiProviderModelListEditor({
    orgId,
    listType,
    items,
    catalogModels,
    excludeKeys,
    onChange,
    disabled,
    emptyMessage,
    addPlaceholder
}: AiProviderModelListEditorProps) {
    const t = useTranslations();
    const [editingClientId, setEditingClientId] = useState<string | null>(null);
    const [addOpen, setAddOpen] = useState(false);
    const [addQuery, setAddQuery] = useState("");
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
    const [listExpanded, setListExpanded] = useState(false);
    const [clipHeight, setClipHeight] = useState<number | null>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const collapsedLimit = GRID_COLUMNS * COLLAPSED_ROWS;
    const hasOverflow = items.length > collapsedLimit;
    const isCollapsed = hasOverflow && !listExpanded;

    const catalogSet = useMemo(() => new Set(catalogModels), [catalogModels]);

    const blockedKeys = useMemo(() => {
        const set = new Set<string>(excludeKeys ? [...excludeKeys] : []);
        for (const item of items) {
            set.add(item.modelKey);
        }
        return set;
    }, [excludeKeys, items]);

    const availableCatalog = useMemo(() => {
        const q = addQuery.trim().toLowerCase();
        return catalogModels
            .filter((model) => !blockedKeys.has(model))
            .filter((model) => (q ? model.toLowerCase().includes(q) : true));
    }, [addQuery, blockedKeys, catalogModels]);

    const trimmedQuery = addQuery.trim();
    const bulkKeys = useMemo(
        () =>
            parseBulkKeys(addQuery).filter(
                (key) => !blockedKeys.has(key) && !catalogSet.has(key)
            ),
        [addQuery, blockedKeys, catalogSet]
    );
    const canAddCustom =
        bulkKeys.length === 1 &&
        !trimmedQuery.includes("\n") &&
        !trimmedQuery.includes(",") &&
        !isAllModelsKey(trimmedQuery) &&
        !catalogSet.has(trimmedQuery) &&
        !blockedKeys.has(trimmedQuery);
    const canAddBulkCustom = bulkKeys.length > 1;

    const allModelsLabel = t("aiProviderModelsAllLabel");
    const showAllModelsOption =
        !blockedKeys.has(ALL_MODELS_KEY) &&
        (!trimmedQuery ||
            trimmedQuery === ALL_MODELS_KEY ||
            "all".includes(trimmedQuery.toLowerCase()) ||
            allModelsLabel.toLowerCase().includes(trimmedQuery.toLowerCase()));

    const editing = items.find((item) => item.clientId === editingClientId);

    function appendModels(modelKeys: string[]) {
        if (disabled) return;
        const nextBlocked = new Set(blockedKeys);
        const additions: AiProviderModelListItem[] = [];
        for (const raw of modelKeys) {
            const key = raw.trim();
            if (!key || nextBlocked.has(key)) continue;
            nextBlocked.add(key);
            additions.push({
                clientId: newClientId(),
                modelKey: key,
                listType,
                hasBudget: false
            });
        }
        if (additions.length === 0) return;
        onChange([...items, ...additions]);
    }

    function addModel(modelKey: string, options?: { keepOpen?: boolean }) {
        appendModels([modelKey]);
        setAddQuery("");
        setSelectedKeys(new Set());
        if (!options?.keepOpen) {
            setAddOpen(false);
        }
    }

    function addSelected() {
        appendModels([...selectedKeys]);
        setSelectedKeys(new Set());
        setAddQuery("");
        // Keep open so more can be selected after filter refresh
    }

    function addBulkCustom() {
        appendModels(bulkKeys);
        setAddQuery("");
        setSelectedKeys(new Set());
    }

    function toggleSelected(model: string) {
        setSelectedKeys((prev) => {
            const next = new Set(prev);
            if (next.has(model)) {
                next.delete(model);
            } else {
                next.add(model);
            }
            return next;
        });
    }

    function selectAllVisible() {
        setSelectedKeys((prev) => {
            const next = new Set(prev);
            for (const model of availableCatalog) {
                next.add(model);
            }
            return next;
        });
    }

    function clearSelected() {
        setSelectedKeys(new Set());
    }

    function removeModel(clientId: string) {
        onChange(items.filter((item) => item.clientId !== clientId));
    }

    function updateModel(updated: AiProviderModelListItem) {
        onChange(
            items.map((item) =>
                item.clientId === updated.clientId ? updated : item
            )
        );
        setEditingClientId(null);
    }

    // Drop selections that are no longer available (already added).
    useEffect(() => {
        setSelectedKeys((prev) => {
            let changed = false;
            const next = new Set<string>();
            for (const key of prev) {
                if (blockedKeys.has(key)) {
                    changed = true;
                    continue;
                }
                next.add(key);
            }
            return changed ? next : prev;
        });
    }, [blockedKeys]);

    useEffect(() => {
        if (!hasOverflow) {
            setListExpanded(false);
        }
    }, [hasOverflow]);

    useLayoutEffect(() => {
        if (!isCollapsed || !gridRef.current) {
            setClipHeight(null);
            return;
        }

        const children = Array.from(gridRef.current.children) as HTMLElement[];
        const lastVisible = children[collapsedLimit - 1];
        if (!lastVisible) {
            setClipHeight(null);
            return;
        }

        const gridTop = gridRef.current.getBoundingClientRect().top;
        const cardBottom = lastVisible.getBoundingClientRect().bottom;
        // Peek slightly into the next row so the fade has content to soften.
        setClipHeight(cardBottom - gridTop + 12);
    }, [isCollapsed, collapsedLimit, items]);

    return (
        <div className="flex flex-col gap-3">
            {items.length === 0 ? (
                <p className="text-sm text-muted-foreground">{emptyMessage}</p>
            ) : (
                <div>
                    <div className="relative">
                        <div
                            ref={gridRef}
                            className={cn(
                                "grid grid-cols-2 gap-2",
                                isCollapsed && "overflow-hidden"
                            )}
                            style={
                                isCollapsed && clipHeight != null
                                    ? { maxHeight: clipHeight }
                                    : undefined
                            }
                        >
                            {items.map((item) => (
                                <ModelCard
                                    key={item.clientId}
                                    item={item}
                                    source={resolveModelSource(
                                        item.modelKey,
                                        catalogSet
                                    )}
                                    disabled={disabled}
                                    onEdit={() =>
                                        setEditingClientId(item.clientId)
                                    }
                                    onRemove={() => removeModel(item.clientId)}
                                />
                            ))}
                        </div>
                        {isCollapsed ? (
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-card from-25% via-card/80 to-transparent" />
                        ) : null}
                    </div>
                    {isCollapsed ? (
                        <div className="relative z-10 flex justify-center pt-2">
                            <Button
                                type="button"
                                variant="text"
                                size="sm"
                                className="bg-card px-2 text-muted-foreground hover:text-foreground"
                                onClick={() => setListExpanded(true)}
                            >
                                {t("aiProviderModelsViewMore", {
                                    count: items.length - collapsedLimit
                                })}
                            </Button>
                        </div>
                    ) : null}
                    {hasOverflow && listExpanded ? (
                        <div className="flex justify-center pt-1">
                            <Button
                                type="button"
                                variant="text"
                                size="sm"
                                className="text-muted-foreground hover:text-foreground"
                                onClick={() => setListExpanded(false)}
                            >
                                {t("aiProviderModelsViewLess")}
                            </Button>
                        </div>
                    ) : null}
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
                <Popover
                    open={addOpen}
                    onOpenChange={(open) => {
                        if (disabled) return;
                        setAddOpen(open);
                        if (!open) {
                            setAddQuery("");
                            setSelectedKeys(new Set());
                        }
                    }}
                >
                    <PopoverTrigger asChild>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-fit"
                            disabled={disabled}
                        >
                            <Plus className="size-4" />
                            {t("aiProviderModelsAdd")}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent
                        align="start"
                        collisionPadding={8}
                        className="flex w-[min(100vw-2rem,24rem)] max-h-[min(24rem,var(--radix-popover-content-available-height))] flex-col overflow-hidden p-0"
                    >
                        <Command
                            shouldFilter={false}
                            className="flex min-h-0 flex-1 flex-col overflow-hidden"
                        >
                            <CommandInput
                                placeholder={addPlaceholder}
                                value={addQuery}
                                onValueChange={setAddQuery}
                                onKeyDown={(e) => {
                                    if (e.key !== "Enter") return;
                                    if (canAddBulkCustom) {
                                        e.preventDefault();
                                        addBulkCustom();
                                        return;
                                    }
                                    if (canAddCustom) {
                                        e.preventDefault();
                                        addModel(trimmedQuery, {
                                            keepOpen: true
                                        });
                                    }
                                }}
                            />
                            <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5">
                                <p className="text-xs text-muted-foreground">
                                    {t("aiProviderModelsBulkHint")}
                                </p>
                                {availableCatalog.length > 0 ? (
                                    <div className="flex shrink-0 gap-1">
                                        <Button
                                            type="button"
                                            variant="text"
                                            size="sm"
                                            className="h-auto px-1 text-xs"
                                            onClick={selectAllVisible}
                                        >
                                            {t("aiProviderModelsSelectAll")}
                                        </Button>
                                        {selectedKeys.size > 0 ? (
                                            <Button
                                                type="button"
                                                variant="text"
                                                size="sm"
                                                className="h-auto px-1 text-xs"
                                                onClick={clearSelected}
                                            >
                                                {t(
                                                    "aiProviderModelsClearSelected"
                                                )}
                                            </Button>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                            <CommandList className="max-h-none min-h-0 flex-1 overflow-y-auto overscroll-contain">
                                <CommandEmpty>
                                    {canAddBulkCustom
                                        ? t("aiProviderModelsAddBulkHint", {
                                              count: bulkKeys.length
                                          })
                                        : canAddCustom
                                          ? t("aiProviderModelsAddCustomHint")
                                          : t("aiProviderModelsCatalogEmpty")}
                                </CommandEmpty>
                                {showAllModelsOption ? (
                                    <CommandGroup className="overflow-visible">
                                        <CommandItem
                                            value={`all:${ALL_MODELS_KEY}`}
                                            onSelect={() =>
                                                addModel(ALL_MODELS_KEY, {
                                                    keepOpen: true
                                                })
                                            }
                                            className="items-start gap-2 py-2"
                                        >
                                            <Globe className="mt-0.5 size-4 shrink-0" />
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-medium">
                                                    {listType === "allow"
                                                        ? t(
                                                              "aiProviderModelsAddAllAllow"
                                                          )
                                                        : t(
                                                              "aiProviderModelsAddAllBlock"
                                                          )}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {t(
                                                        "aiProviderModelsAddAllDescription"
                                                    )}
                                                </p>
                                            </div>
                                        </CommandItem>
                                    </CommandGroup>
                                ) : null}
                                {canAddBulkCustom ? (
                                    <CommandGroup className="overflow-visible">
                                        <CommandItem
                                            value={`bulk:${bulkKeys.join(",")}`}
                                            onSelect={addBulkCustom}
                                        >
                                            <Plus className="mr-2 size-4" />
                                            {t("aiProviderModelsAddBulk", {
                                                count: bulkKeys.length
                                            })}
                                        </CommandItem>
                                    </CommandGroup>
                                ) : null}
                                {canAddCustom ? (
                                    <CommandGroup className="overflow-visible">
                                        <CommandItem
                                            value={`custom:${trimmedQuery}`}
                                            onSelect={() =>
                                                addModel(trimmedQuery, {
                                                    keepOpen: true
                                                })
                                            }
                                        >
                                            <Plus className="mr-2 size-4" />
                                            {t("aiProviderModelsAddCustom", {
                                                key: trimmedQuery
                                            })}
                                        </CommandItem>
                                    </CommandGroup>
                                ) : null}
                                {availableCatalog.length > 0 ? (
                                    <CommandGroup
                                        heading={t(
                                            "aiProviderModelsCatalogHeading"
                                        )}
                                        className="overflow-visible"
                                    >
                                        {availableCatalog.map((model) => {
                                            const isSelected =
                                                selectedKeys.has(model);
                                            return (
                                                <CommandItem
                                                    key={model}
                                                    value={model}
                                                    onSelect={() => {
                                                        // Toggle selection for bulk;
                                                        // double-purpose: shift-free multi-pick.
                                                        toggleSelected(model);
                                                    }}
                                                    className="gap-2"
                                                >
                                                    <Checkbox
                                                        checked={isSelected}
                                                        className="pointer-events-none"
                                                        tabIndex={-1}
                                                        aria-hidden
                                                    />
                                                    <span className="min-w-0 flex-1 truncate font-mono text-xs">
                                                        {model}
                                                    </span>
                                                </CommandItem>
                                            );
                                        })}
                                    </CommandGroup>
                                ) : null}
                            </CommandList>
                            {selectedKeys.size > 0 ? (
                                <div className="flex shrink-0 items-center justify-between gap-2 border-t p-2">
                                    <span className="text-xs text-muted-foreground">
                                        {t("aiProviderModelsSelectedCount", {
                                            count: selectedKeys.size
                                        })}
                                    </span>
                                    <Button
                                        type="button"
                                        size="sm"
                                        onClick={addSelected}
                                    >
                                        {t("aiProviderModelsAddSelected")}
                                    </Button>
                                </div>
                            ) : null}
                        </Command>
                    </PopoverContent>
                </Popover>
                {items.length > 0 ? (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-fit"
                        disabled={disabled}
                        onClick={() => onChange([])}
                    >
                        {t("aiProviderModelsClearAll")}
                    </Button>
                ) : null}
            </div>

            {editing && (
                <EditModelCredenza
                    orgId={orgId}
                    item={editing}
                    open={editingClientId !== null}
                    onOpenChange={(open) => {
                        if (!open) setEditingClientId(null);
                    }}
                    existingKeys={blockedKeys}
                    onSave={updateModel}
                />
            )}
        </div>
    );
}

function ModelCard({
    item,
    source,
    disabled,
    onEdit,
    onRemove
}: {
    item: AiProviderModelListItem;
    source: ModelSource;
    disabled?: boolean;
    onEdit: () => void;
    onRemove: () => void;
}) {
    const t = useTranslations();

    return (
        <div
            className={cn(
                "flex min-w-0 items-center gap-2 rounded-md border border-input px-2.5 py-2",
                disabled && "opacity-60",
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
            title={t("aiProviderModelsEditHint")}
        >
            <div className="min-w-0 flex-1">
                {source === "all" ? (
                    <span className="block truncate text-xs font-medium">
                        {t("aiProviderModelsAllLabel")}
                    </span>
                ) : (
                    <span className="block truncate font-mono text-xs font-medium">
                        {item.modelKey}
                    </span>
                )}
            </div>
            <button
                type="button"
                className="shrink-0 p-0.5 text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-50"
                disabled={disabled}
                aria-label={t("aiProviderModelsRemove")}
                onClick={(e) => {
                    e.stopPropagation();
                    onRemove();
                }}
            >
                <XIcon className="size-3.5" />
            </button>
        </div>
    );
}

type EditFormValues = {
    modelKey: string;
};

function EditModelCredenza({
    orgId,
    item,
    open,
    onOpenChange,
    existingKeys,
    onSave
}: {
    orgId: string;
    item: AiProviderModelListItem;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    existingKeys: ReadonlySet<string>;
    onSave: (item: AiProviderModelListItem) => void;
}) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const queryClient = useQueryClient();

    const editSchema = useMemo(
        () =>
            z.object({
                modelKey: z
                    .string()
                    .trim()
                    .min(1, t("aiProviderModelsKeyRequired"))
                    .refine(
                        (key) =>
                            key === item.modelKey || !existingKeys.has(key),
                        t("aiProviderModelsKeyDuplicate")
                    )
            }),
        [existingKeys, item.modelKey, t]
    );

    const form = useForm<EditFormValues>({
        resolver: zodResolver(editSchema),
        defaultValues: { modelKey: item.modelKey }
    });

    const [pendingBudgetRows, setPendingBudgetRows] = useState<BudgetRow[]>([]);
    const [attemptedBudgetsSave, setAttemptedBudgetsSave] = useState(false);
    const [savingBudgets, setSavingBudgets] = useState(false);

    const budgetScope =
        item.modelId !== undefined
            ? { type: "model" as const, id: item.modelId }
            : null;

    const budgetsQuery = useQuery({
        ...aiBudgetQueries.scoped({
            scope: budgetScope ?? { type: "model", id: -1 }
        }),
        enabled: open && budgetScope !== null
    });

    useEffect(() => {
        if (!open) return;
        form.reset({ modelKey: item.modelKey });
        setAttemptedBudgetsSave(false);
        if (item.modelId === undefined) {
            setPendingBudgetRows(item.pendingBudgets ?? []);
        } else {
            setPendingBudgetRows([]);
        }
    }, [
        form,
        item.clientId,
        item.modelId,
        item.modelKey,
        item.pendingBudgets,
        open
    ]);

    useEffect(() => {
        if (!open || !budgetsQuery.data) return;
        setPendingBudgetRows(rowsFromBudgets(budgetsQuery.data));
    }, [open, budgetsQuery.data]);

    async function handleSubmit(values: EditFormValues) {
        const { conflictingKeys, invalidAmountKeys } =
            getBudgetRowsErrors(pendingBudgetRows);
        if (conflictingKeys.size > 0 || invalidAmountKeys.size > 0) {
            setAttemptedBudgetsSave(true);
            toast({
                variant: "destructive",
                title: t("aiBudgetErrorSave"),
                description: conflictingKeys.size
                    ? t("aiBudgetConflictError")
                    : t("aiBudgetInvalidAmountError")
            });
            return;
        }

        if (budgetScope) {
            setSavingBudgets(true);
            try {
                const existingBudgets = await queryClient.fetchQuery(
                    aiBudgetQueries.scoped({ scope: budgetScope })
                );
                await saveBudgetRows({
                    api,
                    orgId,
                    scope: budgetScope,
                    existingBudgets,
                    rows: pendingBudgetRows
                });
                await queryClient.invalidateQueries(
                    aiBudgetQueries.scoped({ scope: budgetScope })
                );
            } catch (e) {
                toast({
                    variant: "destructive",
                    title: t("aiBudgetErrorSave"),
                    description: formatAxiosError(e, t("aiBudgetErrorSave"))
                });
                setSavingBudgets(false);
                return;
            }
            setSavingBudgets(false);
        }

        onSave({
            ...item,
            modelKey: values.modelKey.trim(),
            pendingBudgets: pendingBudgetRows,
            hasBudget: pendingBudgetRows.length > 0
        });
    }

    return (
        <Credenza open={open} onOpenChange={onOpenChange}>
            <CredenzaContent>
                <CredenzaHeader>
                    <CredenzaTitle>
                        {t("aiProviderModelsEditTitle")}
                    </CredenzaTitle>
                    <CredenzaDescription>
                        {t("aiProviderModelsEditDescription")}
                    </CredenzaDescription>
                </CredenzaHeader>
                <Form {...form}>
                    <form
                        id="ai-provider-model-edit-form"
                        onSubmit={form.handleSubmit(handleSubmit)}
                    >
                        <CredenzaBody>
                            <HorizontalTabs
                                clientSide={true}
                                defaultTab={0}
                                items={[
                                    { title: t("general"), href: "#" },
                                    {
                                        title: t("aiProviderModelsBudgetTab"),
                                        href: "#"
                                    }
                                ]}
                            >
                                <div className="space-y-4 mt-4">
                                    <FormField
                                        control={form.control}
                                        name="modelKey"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t(
                                                        "aiProviderModelsKeyLabel"
                                                    )}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input
                                                        {...field}
                                                        autoComplete="off"
                                                        spellCheck={false}
                                                        className="font-mono"
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                                <div className="space-y-4 mt-4">
                                    <BudgetRowsFields
                                        rows={pendingBudgetRows}
                                        onChange={setPendingBudgetRows}
                                        disabled={
                                            budgetScope !== null &&
                                            budgetsQuery.isLoading
                                        }
                                        attemptedSave={attemptedBudgetsSave}
                                    />
                                </div>
                            </HorizontalTabs>
                        </CredenzaBody>
                    </form>
                </Form>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button type="button" variant="outline">
                            {t("cancel")}
                        </Button>
                    </CredenzaClose>
                    <Button
                        type="submit"
                        form="ai-provider-model-edit-form"
                        loading={savingBudgets}
                        disabled={savingBudgets}
                    >
                        {t("save")}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
