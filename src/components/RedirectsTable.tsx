"use client";

import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import CopyToClipboard from "@app/components/CopyToClipboard";
import {
    ResourceSelector,
    type SelectedResource
} from "@app/components/resource-selector";
import { Badge } from "@app/components/ui/badge";
import { Button } from "@app/components/ui/button";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList
} from "@app/components/ui/command";
import {
    ControlledDataTable,
    type ExtendedColumnDef
} from "@app/components/ui/controlled-data-table";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@app/components/ui/dropdown-menu";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
import { Switch } from "@app/components/ui/switch";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useNavigationContext } from "@app/hooks/useNavigationContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { cn } from "@app/lib/cn";
import { dataTableFilterPopoverContentClassName } from "@app/lib/dataTableFilterPopover";
import { orgQueries } from "@app/lib/queries";
import { getNextSortOrder, getSortDirection } from "@app/lib/sortColumn";
import { useQuery } from "@tanstack/react-query";
import type { PaginationState } from "@tanstack/react-table";
import {
    ArrowDown,
    ArrowDown01Icon,
    ArrowRight,
    ArrowUp,
    ArrowUp10Icon,
    ArrowUpRight,
    CheckIcon,
    ChevronsUpDownIcon,
    Funnel,
    MinusIcon,
    MoreHorizontal
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
    useMemo,
    useOptimistic,
    useRef,
    useState,
    useTransition,
    type ComponentRef,
    type ReactNode
} from "react";
import { useDebouncedCallback } from "use-debounce";
import { ColumnFilterButton } from "./ColumnFilterButton";
import { InfoPopup } from "./ui/info-popup";

const booleanSearchFilterSchema = z
    .enum(["true", "false"])
    .optional()
    .catch(undefined);

export type RedirectRow = {
    redirectId: number;
    niceId: string;
    name: string;
    subdomain: string | null;
    destinationHost: string;
    pathMatchType: "exact" | "prefix" | "regex";
    matchPath: string | null;
    rewritePath: string | null;
    rewritePathType: "exact" | "prefix" | "regex" | "stripPrefix" | null;
    priority: number | null;
    permanent: boolean;
    enabled: boolean;
    resourceId: number | null;
    resourceName: string | null;
    resourceNiceId: string | null;
    resourceFullDomain: string | null;
    resourceDomainId: string | null;
    domainId: string | null;
    baseDomain: string | null;
};

export type RedirectFilterDomain = {
    domainId: string;
    baseDomain: string;
};

type RedirectsTableProps = {
    redirects: RedirectRow[];
    orgId: string;
    pagination: PaginationState;
    rowCount: number;
    initialFilterResource?: SelectedResource | null;
    initialFilterDomain?: RedirectFilterDomain | null;
};

export default function RedirectsTable({
    redirects,
    orgId,
    pagination,
    rowCount,
    initialFilterResource = null,
    initialFilterDomain = null
}: RedirectsTableProps) {
    const router = useRouter();
    const t = useTranslations();
    const api = createApiClient(useEnvContext());
    const {
        navigate: filter,
        isNavigating: isFiltering,
        searchParams
    } = useNavigationContext();

    const [selected, setSelected] = useState<RedirectRow | null>(null);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isRefreshing, startTransition] = useTransition();
    const [isNavigatingToAddPage, startNavigation] = useTransition();
    const [domainFilterOpen, setDomainFilterOpen] = useState(false);
    const [resourceFilterOpen, setResourceFilterOpen] = useState(false);

    const domainIdQ = searchParams.get("domainId");
    const selectedDomain: RedirectFilterDomain | null = useMemo(() => {
        if (!domainIdQ) {
            return null;
        }
        if (initialFilterDomain && initialFilterDomain.domainId === domainIdQ) {
            return initialFilterDomain;
        }
        return {
            domainId: domainIdQ,
            baseDomain: t("redirectFilterDomainFallback", { id: domainIdQ })
        };
    }, [domainIdQ, initialFilterDomain, t]);

    const resourceIdQ = searchParams.get("resourceId");
    const resourceIdNum = resourceIdQ ? parseInt(resourceIdQ, 10) : NaN;
    const selectedResource: SelectedResource | null = useMemo(() => {
        if (
            !resourceIdQ ||
            !Number.isInteger(resourceIdNum) ||
            resourceIdNum <= 0
        ) {
            return null;
        }
        if (
            initialFilterResource &&
            initialFilterResource.resourceId === resourceIdNum
        ) {
            return initialFilterResource;
        }
        return {
            name: t("redirectFilterResourceFallback", { id: resourceIdNum }),
            resourceId: resourceIdNum,
            fullDomain: null,
            niceId: "",
            ssl: false,
            wildcard: false
        };
    }, [initialFilterResource, resourceIdQ, resourceIdNum, t]);

    function refreshData() {
        startTransition(() => {
            try {
                router.refresh();
            } catch {
                toast({
                    title: t("error"),
                    description: t("refreshError"),
                    variant: "destructive"
                });
            }
        });
    }

    const handlePaginationChange = (newPage: PaginationState) => {
        searchParams.set("page", (newPage.pageIndex + 1).toString());
        searchParams.set("pageSize", newPage.pageSize.toString());
        filter({ searchParams });
    };

    const handleSearchChange = useDebouncedCallback((query: string) => {
        searchParams.set("query", query);
        searchParams.delete("page");
        filter({ searchParams });
    }, 300);

    function handleFilterChange(
        column: string,
        value: string | undefined | null | string[]
    ) {
        searchParams.delete(column);
        searchParams.delete("page");

        if (typeof value === "string") {
            searchParams.set(column, value);
        } else if (value) {
            value.forEach((val) => searchParams.append(column, val));
        }

        filter({ searchParams });
    }

    const clearDomainFilter = () => {
        handleFilterChange("domainId", undefined);
        setDomainFilterOpen(false);
    };

    const clearResourceFilter = () => {
        handleFilterChange("resourceId", undefined);
        setResourceFilterOpen(false);
    };

    const onPickDomain = (domain: RedirectFilterDomain) => {
        handleFilterChange("domainId", domain.domainId);
        setDomainFilterOpen(false);
    };

    const onPickResource = (resource: SelectedResource) => {
        handleFilterChange("resourceId", String(resource.resourceId));
        setResourceFilterOpen(false);
    };

    function toggleSort(column: string) {
        filter({ searchParams: getNextSortOrder(column, searchParams) });
    }

    // Prefix matches/rewrites cover everything beneath the path, so show the
    // implied glob rather than the bare prefix.
    function withPrefixGlob(path: string) {
        return path.endsWith("/") ? `${path}*` : `${path}/*`;
    }

    async function toggleEnabled(enabled: boolean, redirectId: number) {
        try {
            await api.post(`/org/${orgId}/redirects/${redirectId}`, {
                enabled
            });
            toast({
                title: t("success"),
                description: t("redirectUpdated")
            });
            router.refresh();
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("redirectErrorUpdate"),
                description: formatAxiosError(e, t("redirectErrorUpdate"))
            });
        }
    }

    function deleteRedirect(row: RedirectRow) {
        startTransition(async () => {
            try {
                await api.delete(`/org/${orgId}/redirects/${row.redirectId}`);
                setIsDeleteModalOpen(false);
                setSelected(null);
                toast({
                    title: t("success"),
                    description: t("redirectDeleted")
                });
                router.refresh();
            } catch (e) {
                toast({
                    variant: "destructive",
                    title: t("redirectErrorDelete"),
                    description: formatAxiosError(e, t("redirectErrorDelete"))
                });
            }
        });
    }

    const columns = useMemo<ExtendedColumnDef<RedirectRow>[]>(
        () => [
            {
                accessorKey: "name",
                enableHiding: false,
                friendlyName: t("name"),
                header: () => {
                    const nameOrder = getSortDirection("name", searchParams);
                    const Icon =
                        nameOrder === "asc"
                            ? ArrowDown01Icon
                            : nameOrder === "desc"
                              ? ArrowUp10Icon
                              : ChevronsUpDownIcon;

                    return (
                        <Button
                            variant="ghost"
                            className="p-3"
                            onClick={() => toggleSort("name")}
                        >
                            {t("name")}
                            <Icon className="ml-2 h-4 w-4" />
                        </Button>
                    );
                },
                cell: ({ row }) => (
                    <Link
                        href={`/${orgId}/settings/redirects/${row.original.niceId}`}
                        className="hover:underline"
                    >
                        {row.original.name}
                    </Link>
                )
            },
            {
                id: "niceId",
                accessorKey: "niceId",
                friendlyName: t("identifier"),
                header: () => <span className="p-3">{t("identifier")}</span>,
                cell: ({ row }) => <span>{row.original.niceId}</span>
            },
            {
                id: "domain",
                friendlyName: t("domain"),
                header: () => (
                    <ColumnEntityFilter
                        label={t("domain")}
                        open={domainFilterOpen}
                        onOpenChange={setDomainFilterOpen}
                        selectedName={selectedDomain?.baseDomain}
                        clearLabel={t("redirectFilterAnyDomain")}
                        onClear={clearDomainFilter}
                    >
                        <DomainFilterList
                            orgId={orgId}
                            selectedDomainId={selectedDomain?.domainId ?? null}
                            onSelect={onPickDomain}
                        />
                    </ColumnEntityFilter>
                ),
                cell: ({ row }) => {
                    const redirect = row.original;

                    if (!redirect.domainId || !redirect.baseDomain) {
                        return <span>-</span>;
                    }

                    return (
                        <Button
                            variant="outline"
                            size="sm"
                            asChild
                            className="inline-flex items-center gap-1.5"
                        >
                            <Link
                                href={`/${orgId}/settings/domains/${redirect.domainId}`}
                            >
                                {redirect.baseDomain}
                                <ArrowUpRight className="size-3" />
                            </Link>
                        </Button>
                    );
                }
            },
            {
                id: "resource",
                friendlyName: t("resource"),
                header: () => (
                    <ColumnEntityFilter
                        label={t("resource")}
                        open={resourceFilterOpen}
                        onOpenChange={setResourceFilterOpen}
                        selectedName={selectedResource?.name}
                        clearLabel={t("redirectFilterAnyResource")}
                        onClear={clearResourceFilter}
                    >
                        <ResourceSelector
                            orgId={orgId}
                            selectedResource={selectedResource}
                            onSelectResource={onPickResource}
                        />
                    </ColumnEntityFilter>
                ),
                cell: ({ row }) => {
                    const redirect = row.original;

                    if (
                        !redirect.resourceId ||
                        !redirect.resourceName ||
                        !redirect.resourceNiceId
                    ) {
                        return <span>-</span>;
                    }

                    return (
                        <Button
                            variant="outline"
                            size="sm"
                            asChild
                            className="inline-flex items-center gap-1.5"
                        >
                            <Link
                                href={`/${orgId}/settings/resources/public/${redirect.resourceNiceId}`}
                            >
                                {redirect.resourceName}
                                <ArrowUpRight className="size-3" />
                            </Link>
                        </Button>
                    );
                }
            },

            {
                id: "source",
                friendlyName: t("redirectSource"),
                header: () => (
                    <span className="p-3">{t("redirectSource")}</span>
                ),
                cell: ({ row }) => {
                    const redirect = row.original;
                    // A domain-attached redirect may target a specific host
                    // under the base domain, e.g. old.example.com.
                    const domainHost = redirect.baseDomain
                        ? [redirect.subdomain, redirect.baseDomain]
                              .filter(Boolean)
                              .join(".")
                        : null;
                    const host = redirect.resourceFullDomain ?? domainHost;

                    if (redirect.resourceId && !redirect.resourceDomainId) {
                        return (
                            <InfoPopup
                                info={t("redirectDomainNotFoundDescription")}
                                text={t("domainNotFound")}
                            />
                        );
                    }

                    const matchPath = redirect.matchPath
                        ? redirect.pathMatchType === "prefix"
                            ? withPrefixGlob(redirect.matchPath)
                            : redirect.matchPath
                        : "";
                    const source = `${host ?? ""}${matchPath}`;

                    if (!source) {
                        return <span>-</span>;
                    }

                    return <CopyToClipboard text={source} isLink={false} />;
                }
            },
            {
                id: "destination",
                accessorKey: "destinationHost",
                friendlyName: t("redirectDestination"),
                header: () => (
                    <span className="p-3">{t("redirectDestination")}</span>
                ),
                cell: ({ row }) => {
                    const redirect = row.original;
                    const rewritePath = redirect.rewritePath
                        ? redirect.rewritePathType === "prefix"
                            ? withPrefixGlob(redirect.rewritePath)
                            : redirect.rewritePath
                        : "";
                    const destination = `${redirect.destinationHost}${rewritePath}`;

                    if (!destination) {
                        return <span>-</span>;
                    }

                    return (
                        <CopyToClipboard text={destination} isLink={false} />
                    );
                }
            },
            {
                accessorKey: "priority",
                friendlyName: t("priority"),
                header: () => {
                    const priorityOrder = getSortDirection(
                        "priority",
                        searchParams
                    );
                    const Icon =
                        priorityOrder === "asc"
                            ? ArrowDown01Icon
                            : priorityOrder === "desc"
                              ? ArrowUp10Icon
                              : ChevronsUpDownIcon;

                    return (
                        <Button
                            variant="ghost"
                            className="p-3"
                            onClick={() => toggleSort("priority")}
                        >
                            {t("priority")}
                            <Icon className="ml-2 h-4 w-4" />
                        </Button>
                    );
                },
                cell: ({ row }) => {
                    // 100 is the automatic default; anything else was set
                    // deliberately, so flag which way it deviates.
                    const priority = row.original.priority ?? 100;
                    return (
                        <span className="inline-flex items-center gap-1">
                            {priority}
                            {priority > 100 ? (
                                <ArrowUp className="size-3 text-green-500" />
                            ) : priority < 100 ? (
                                <ArrowDown className="size-3 text-red-500" />
                            ) : (
                                <MinusIcon className="size-3 text-muted-foreground" />
                            )}
                        </span>
                    );
                }
            },
            {
                accessorKey: "permanent",
                friendlyName: t("redirectType"),
                header: () => (
                    <ColumnFilterButton
                        options={[
                            {
                                value: "permanent",
                                label: t("redirectTypePermanent")
                            },
                            {
                                value: "temporary",
                                label: t("redirectTypeTemporary")
                            }
                        ]}
                        selectedValue={searchParams.get("type") ?? undefined}
                        onValueChange={(value) =>
                            handleFilterChange("type", value)
                        }
                        searchPlaceholder={t("searchPlaceholder")}
                        emptyMessage={t("emptySearchOptions")}
                        label={t("redirectType")}
                        className="p-3"
                    />
                ),
                cell: ({ row }) => (
                    <Badge variant="secondary">
                        {row.original.permanent
                            ? t("redirectTypePermanent")
                            : t("redirectTypeTemporary")}
                    </Badge>
                )
            },
            {
                accessorKey: "enabled",
                friendlyName: t("enabled"),
                header: () => (
                    <ColumnFilterButton
                        options={[
                            { value: "true", label: t("enabled") },
                            { value: "false", label: t("disabled") }
                        ]}
                        selectedValue={booleanSearchFilterSchema.parse(
                            searchParams.get("enabled")
                        )}
                        onValueChange={(value) =>
                            handleFilterChange("enabled", value)
                        }
                        searchPlaceholder={t("searchPlaceholder")}
                        emptyMessage={t("emptySearchOptions")}
                        label={t("enabled")}
                        className="p-3"
                    />
                ),
                cell: ({ row }) => (
                    <RedirectEnabledForm
                        redirect={row.original}
                        onToggleEnabled={toggleEnabled}
                    />
                )
            },
            {
                id: "actions",
                enableHiding: false,
                header: () => <span className="p-3" />,
                cell: ({ row }) => (
                    <div className="flex items-center gap-2 justify-end">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="h-8 w-8 p-0">
                                    <span className="sr-only">
                                        {t("openMenu")}
                                    </span>
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild>
                                    <Link
                                        href={`/${orgId}/settings/redirects/${row.original.niceId}`}
                                    >
                                        {t("edit")}
                                    </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={() => {
                                        setSelected(row.original);
                                        setIsDeleteModalOpen(true);
                                    }}
                                >
                                    <span className="text-red-500">
                                        {t("delete")}
                                    </span>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Link
                            href={`/${orgId}/settings/redirects/${row.original.niceId}`}
                        >
                            <Button variant="outline">
                                {t("edit")}
                                <ArrowRight className="ml-2 w-4 h-4" />
                            </Button>
                        </Link>
                    </div>
                )
            }
        ],
        [
            orgId,
            t,
            searchParams,
            domainFilterOpen,
            resourceFilterOpen,
            selectedDomain,
            selectedResource
        ]
    );

    return (
        <>
            {selected && (
                <ConfirmDeleteDialog
                    open={isDeleteModalOpen}
                    setOpen={(val) => {
                        setIsDeleteModalOpen(val);
                        if (!val) {
                            setSelected(null);
                        }
                    }}
                    dialog={
                        <div className="space-y-2">
                            <p>{t("redirectQuestionRemove")}</p>
                            <p>{t("redirectMessageRemove")}</p>
                        </div>
                    }
                    buttonText={t("redirectDeleteConfirm")}
                    onConfirm={async () => deleteRedirect(selected)}
                    string={selected.name}
                    title={t("redirectDelete")}
                />
            )}

            <ControlledDataTable
                columns={columns}
                rows={redirects}
                addButtonText={t("redirectAdd")}
                onAdd={() =>
                    startNavigation(() =>
                        router.push(`/${orgId}/settings/redirects/create`)
                    )
                }
                isNavigatingToAddPage={isNavigatingToAddPage}
                tableId="redirects-table"
                searchPlaceholder={t("redirectsSearch")}
                pagination={pagination}
                onPaginationChange={handlePaginationChange}
                searchQuery={searchParams.get("query")?.toString()}
                onSearch={handleSearchChange}
                onRefresh={refreshData}
                isRefreshing={isRefreshing || isFiltering}
                rowCount={rowCount}
                columnVisibility={{
                    niceId: false
                }}
                enableColumnVisibility
                stickyLeftColumn="name"
                stickyRightColumn="actions"
            />
        </>
    );
}

type RedirectEnabledFormProps = {
    redirect: RedirectRow;
    onToggleEnabled: (val: boolean, redirectId: number) => Promise<void>;
};

function RedirectEnabledForm({
    redirect,
    onToggleEnabled
}: RedirectEnabledFormProps) {
    const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(
        redirect.enabled
    );

    const missingDomain = Boolean(
        redirect.resourceId && !redirect.resourceDomainId
    );

    const formRef = useRef<ComponentRef<"form">>(null);

    async function submitAction(formData: FormData) {
        if (missingDomain) return;
        const newEnabled = !(formData.get("enabled") === "on");
        setOptimisticEnabled(newEnabled);
        await onToggleEnabled(newEnabled, redirect.redirectId);
    }

    return (
        <form action={submitAction} ref={formRef}>
            <Switch
                checked={!missingDomain && optimisticEnabled}
                disabled={
                    missingDomain || optimisticEnabled !== redirect.enabled
                }
                name="enabled"
                onCheckedChange={() => formRef.current?.requestSubmit()}
            />
        </form>
    );
}

type ColumnEntityFilterProps = {
    label: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    selectedName?: string | null;
    clearLabel: string;
    onClear: () => void;
    children: ReactNode;
};

function ColumnEntityFilter({
    label,
    open,
    onOpenChange,
    selectedName,
    clearLabel,
    onClear,
    children
}: ColumnEntityFilterProps) {
    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    role="combobox"
                    className={cn(
                        "justify-between text-sm h-8 px-2 w-full p-3",
                        !selectedName && "text-muted-foreground"
                    )}
                >
                    <div className="flex items-center gap-2 min-w-0">
                        {label}
                        <Funnel className="size-4 flex-none" />
                        {selectedName && (
                            <Badge
                                className="truncate max-w-[10rem]"
                                variant="secondary"
                            >
                                {selectedName}
                            </Badge>
                        )}
                    </div>
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className={dataTableFilterPopoverContentClassName}
                align="start"
            >
                <div className="border-b p-1">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-full justify-start font-normal"
                        onClick={onClear}
                    >
                        {clearLabel}
                    </Button>
                </div>
                {children}
            </PopoverContent>
        </Popover>
    );
}

type DomainFilterListProps = {
    orgId: string;
    selectedDomainId: string | null;
    onSelect: (domain: RedirectFilterDomain) => void;
};

function DomainFilterList({
    orgId,
    selectedDomainId,
    onSelect
}: DomainFilterListProps) {
    const t = useTranslations();
    const { data: domains = [] } = useQuery(orgQueries.domains({ orgId }));

    return (
        <Command>
            <CommandInput placeholder={t("domainsSearch")} />
            <CommandList>
                <CommandEmpty>{t("domainsNotFound")}</CommandEmpty>
                <CommandGroup>
                    {domains.map((domain) => (
                        <CommandItem
                            key={domain.domainId}
                            value={domain.baseDomain}
                            onSelect={() =>
                                onSelect({
                                    domainId: domain.domainId,
                                    baseDomain: domain.baseDomain
                                })
                            }
                        >
                            <CheckIcon
                                className={cn(
                                    "mr-2 h-4 w-4",
                                    domain.domainId === selectedDomainId
                                        ? "opacity-100"
                                        : "opacity-0"
                                )}
                            />
                            {domain.baseDomain}
                        </CommandItem>
                    ))}
                </CommandGroup>
            </CommandList>
        </Command>
    );
}
