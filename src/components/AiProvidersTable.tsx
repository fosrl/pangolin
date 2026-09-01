"use client";

import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
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
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useNavigationContext } from "@app/hooks/useNavigationContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import type { PaginationState } from "@tanstack/react-table";
import { ArrowRight, MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useDebouncedCallback } from "use-debounce";

export type AiProviderRow = {
    providerId: number;
    niceId: string;
    name: string;
    type: string;
    routingMode: string;
    enabled: boolean;
    effectiveUpstreamUrl: string | null;
    apiKeyLastChars: string | null;
};

type AiProvidersTableProps = {
    providers: AiProviderRow[];
    orgId: string;
    pagination: PaginationState;
    rowCount: number;
};

export default function AiProvidersTable({
    providers,
    orgId,
    pagination,
    rowCount
}: AiProvidersTableProps) {
    const router = useRouter();
    const t = useTranslations();
    const api = createApiClient(useEnvContext());
    const {
        navigate: filter,
        isNavigating: isFiltering,
        searchParams
    } = useNavigationContext();

    const [rows, setRows] = useState(providers);
    const [selected, setSelected] = useState<AiProviderRow | null>(null);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isRefreshing, startTransition] = useTransition();

    useEffect(() => {
        setRows(providers);
    }, [providers]);

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

    function typeLabel(type: string) {
        const key = `aiProviderType${type.charAt(0).toUpperCase()}${type.slice(1)}`;
        const map: Record<string, string> = {
            openai: "aiProviderTypeOpenai",
            anthropic: "aiProviderTypeAnthropic",
            googleGemini: "aiProviderTypeGoogleGemini",
            vertexAi: "aiProviderTypeVertexAi",
            bedrock: "aiProviderTypeBedrock",
            microsoftFoundry: "aiProviderTypeMicrosoftFoundry",
            openRouter: "aiProviderTypeOpenRouter",
            vercelAiGateway: "aiProviderTypeVercelAiGateway",
            custom: "aiProviderTypeCustom"
        };
        return t(map[type] ?? key);
    }

    function routingLabel(mode: string) {
        return mode === "target"
            ? t("aiProviderRoutingModeTarget")
            : t("aiProviderRoutingModeUrl");
    }

    async function toggleEnabled(row: AiProviderRow, enabled: boolean) {
        setRows((prev) =>
            prev.map((r) =>
                r.providerId === row.providerId ? { ...r, enabled } : r
            )
        );

        try {
            await api.post(`/ai-provider/${row.providerId}`, { enabled });
            toast({
                title: t("success"),
                description: t("aiProviderUpdated")
            });
            router.refresh();
        } catch (e) {
            setRows((prev) =>
                prev.map((r) =>
                    r.providerId === row.providerId
                        ? { ...r, enabled: row.enabled }
                        : r
                )
            );
            toast({
                variant: "destructive",
                title: t("aiProviderErrorUpdate"),
                description: formatAxiosError(e, t("aiProviderErrorUpdate"))
            });
        }
    }

    function deleteProvider(row: AiProviderRow) {
        startTransition(async () => {
            try {
                await api.delete(`/ai-provider/${row.providerId}`);
                setRows((prev) =>
                    prev.filter((r) => r.providerId !== row.providerId)
                );
                setIsDeleteModalOpen(false);
                setSelected(null);
                toast({
                    title: t("success"),
                    description: t("aiProviderDeleted")
                });
                router.refresh();
            } catch (e) {
                toast({
                    variant: "destructive",
                    title: t("aiProviderErrorDelete"),
                    description: formatAxiosError(e, t("aiProviderErrorDelete"))
                });
            }
        });
    }

    const columns = useMemo<ExtendedColumnDef<AiProviderRow>[]>(
        () => [
            {
                accessorKey: "name",
                enableHiding: false,
                header: () => <span className="p-3">{t("name")}</span>,
                cell: ({ row }) => (
                    <Link
                        href={`/${orgId}/settings/ai-providers/${row.original.niceId}`}
                        className="hover:underline"
                    >
                        {row.original.name}
                    </Link>
                )
            },
            {
                accessorKey: "type",
                header: () => (
                    <span className="p-3">{t("aiProviderType")}</span>
                ),
                cell: ({ row }) => typeLabel(row.original.type)
            },
            {
                accessorKey: "routingMode",
                header: () => (
                    <span className="p-3">{t("aiProviderRoutingMode")}</span>
                ),
                cell: ({ row }) => routingLabel(row.original.routingMode)
            },
            {
                accessorKey: "effectiveUpstreamUrl",
                header: () => (
                    <span className="p-3">{t("aiProviderUpstreamUrl")}</span>
                ),
                cell: ({ row }) => (
                    <span>{row.original.effectiveUpstreamUrl ?? "-"}</span>
                )
            },
            {
                accessorKey: "enabled",
                header: () => (
                    <span className="p-3">{t("aiProviderEnabled")}</span>
                ),
                cell: ({ row }) => (
                    <Switch
                        checked={row.original.enabled}
                        onCheckedChange={(checked) =>
                            toggleEnabled(row.original, checked)
                        }
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
                                        href={`/${orgId}/settings/ai-providers/${row.original.niceId}`}
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
                            href={`/${orgId}/settings/ai-providers/${row.original.niceId}`}
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
        [orgId, t]
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
                            <p>{t("aiProviderQuestionRemove")}</p>
                            <p>{t("aiProviderMessageRemove")}</p>
                        </div>
                    }
                    buttonText={t("aiProviderDeleteConfirm")}
                    onConfirm={async () => deleteProvider(selected)}
                    string={selected.name}
                    title={t("aiProviderDelete")}
                />
            )}

            <ControlledDataTable
                columns={columns}
                rows={rows}
                addButtonText={t("aiProvidersAdd")}
                onAdd={() =>
                    router.push(`/${orgId}/settings/ai-providers/create`)
                }
                tableId="ai-providers-table"
                searchPlaceholder={t("aiProvidersSearch")}
                pagination={pagination}
                onPaginationChange={handlePaginationChange}
                searchQuery={searchParams.get("query")?.toString()}
                onSearch={handleSearchChange}
                onRefresh={refreshData}
                isRefreshing={isRefreshing || isFiltering}
                rowCount={rowCount}
                stickyRightColumn="actions"
            />
        </>
    );
}
