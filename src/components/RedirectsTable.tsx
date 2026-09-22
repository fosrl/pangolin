"use client";

import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import { Badge } from "@app/components/ui/badge";
import { Button } from "@app/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@app/components/ui/dropdown-menu";
import { Switch } from "@app/components/ui/switch";
import {
    ControlledDataTable,
    type ExtendedColumnDef
} from "@app/components/ui/controlled-data-table";
import { ResourceAccessCertIndicator } from "@app/components/ResourceAccessCertIndicator";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useNavigationContext } from "@app/hooks/useNavigationContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import type { GetBatchedCertificateResponse } from "@server/routers/certificates/types";
import type { PaginationState } from "@tanstack/react-table";
import {
    ArrowDown,
    ArrowRight,
    ArrowUp,
    ArrowUpRight,
    GlobeIcon,
    MinusIcon,
    MoreHorizontal,
    WaypointsIcon
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    useMemo,
    useOptimistic,
    useRef,
    useState,
    useTransition,
    type ComponentRef
} from "react";
import { useDebouncedCallback } from "use-debounce";
import { wait } from "@app/lib/wait";

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

type RedirectsTableProps = {
    redirects: RedirectRow[];
    orgId: string;
    pagination: PaginationState;
    rowCount: number;
    initialCertificates?: GetBatchedCertificateResponse;
};

export default function RedirectsTable({
    redirects,
    orgId,
    pagination,
    rowCount,
    initialCertificates
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
                header: () => <span className="p-3">{t("name")}</span>,
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
                cell: ({ row }) => (
                    <code className="text-sm">{row.original.niceId}</code>
                )
            },
            {
                id: "attachedTo",
                friendlyName: t("redirectAttachedTo"),
                header: () => (
                    <span className="p-3">{t("redirectAttachedTo")}</span>
                ),
                cell: ({ row }) => {
                    const redirect = row.original;

                    if (redirect.resourceId && redirect.resourceNiceId) {
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
                                    <WaypointsIcon className="size-3 text-muted-foreground" />
                                    {redirect.resourceName}
                                    <ArrowUpRight className="size-3" />
                                </Link>
                            </Button>
                        );
                    }

                    if (redirect.domainId) {
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
                                    <GlobeIcon className="size-3 text-muted-foreground" />
                                    {redirect.baseDomain}
                                    <ArrowUpRight className="size-3" />
                                </Link>
                            </Button>
                        );
                    }

                    return <span>-</span>;
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
                    // The cert lives on whichever domain actually terminates
                    // TLS: the resource's domain when attached to a resource,
                    // otherwise the redirect's own domain.
                    const certDomainId =
                        redirect.resourceDomainId ?? redirect.domainId;

                    return (
                        <div className="flex items-center gap-2 min-w-0">
                            {certDomainId && host ? (
                                <ResourceAccessCertIndicator
                                    orgId={orgId}
                                    domainId={certDomainId}
                                    fullDomain={host}
                                    initialCertValue={
                                        initialCertificates?.[host]
                                    }
                                />
                            ) : null}
                            <code className="text-sm truncate">
                                {host ?? ""}
                                {redirect.matchPath && (
                                    <span className="text-muted-foreground">
                                        {redirect.pathMatchType === "prefix"
                                            ? withPrefixGlob(redirect.matchPath)
                                            : redirect.matchPath}
                                    </span>
                                )}
                            </code>
                        </div>
                    );
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
                    return (
                        <code className="text-sm truncate">
                            {redirect.destinationHost}
                            {redirect.rewritePath && (
                                <span className="text-muted-foreground">
                                    {redirect.rewritePathType === "prefix"
                                        ? withPrefixGlob(redirect.rewritePath)
                                        : redirect.rewritePath}
                                </span>
                            )}
                        </code>
                    );
                }
            },
            {
                accessorKey: "priority",
                friendlyName: t("priority"),
                header: () => <span className="p-3">{t("priority")}</span>,
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
                header: () => <span className="p-3">{t("redirectType")}</span>,
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
                header: () => <span className="p-3">{t("enabled")}</span>,
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
        [orgId, t, initialCertificates]
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
                    attachedTo: false,
                    niceId: false,
                    permanent: false,
                    priority: false
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

    const formRef = useRef<ComponentRef<"form">>(null);

    async function submitAction(formData: FormData) {
        const newEnabled = !(formData.get("enabled") === "on");
        setOptimisticEnabled(newEnabled);
        await onToggleEnabled(newEnabled, redirect.redirectId);
    }

    return (
        <form action={submitAction} ref={formRef}>
            <Switch
                checked={optimisticEnabled}
                disabled={optimisticEnabled !== redirect.enabled}
                name="enabled"
                onCheckedChange={() => formRef.current?.requestSubmit()}
            />
        </form>
    );
}
