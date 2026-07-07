"use client";

import { Button } from "@app/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@app/components/ui/dropdown-menu";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useNavigationContext } from "@app/hooks/useNavigationContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { type PaginationState } from "@tanstack/react-table";
import { ArrowRight, MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useActionState, useMemo, useState, useTransition } from "react";
import { useDebouncedCallback } from "use-debounce";
import {
    ControlledDataTable,
    type ExtendedColumnDef
} from "./ui/controlled-data-table";
import { LabelBadge } from "./label-badge";
import { getNextSortOrder, getSortDirection } from "@app/lib/sortColumn";
import { cn } from "@app/lib/cn";
import ConfirmDeleteDialog from "./ConfirmDeleteDialog";
import { CreateOrgLabelDialog } from "./CreateOrgLabelDialog";
import { EditOrgLabelDialog } from "./EditOrgLabelDialog";

export type LabelRow = {
    labelId: number;
    name: string;
    color: string;
};

type OrgLabelsTableProps = {
    labels: LabelRow[];
    pagination: PaginationState;
    orgId: string;
    rowCount: number;
};

export default function OrgLabelsTable({
    labels,
    orgId,
    pagination,
    rowCount
}: OrgLabelsTableProps) {
    const router = useRouter();

    const {
        navigate: filter,
        isNavigating: isFiltering,
        searchParams
    } = useNavigationContext();

    const [selectedLabel, setSelectedLabel] = useState<LabelRow | null>(null);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);

    const [isRefreshing, startTransition] = useTransition();

    const api = createApiClient(useEnvContext());
    const t = useTranslations();

    function refreshData() {
        startTransition(async () => {
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

    const columns = useMemo<ExtendedColumnDef<LabelRow>[]>(
        () => [
            {
                accessorKey: "name",
                enableHiding: false,
                header: () => {
                    return <span className="p-3">{t("name")}</span>;
                },
                cell: ({ row }) => (
                    <div className="flex items-center gap-1.5 group">
                        <div
                            className="size-2 rounded-full bg-(--color) flex-none"
                            style={{
                                // @ts-expect-error css color
                                "--color": row.original.color
                            }}
                        />

                        {row.original.name}
                    </div>
                )
            },
            {
                id: "actions",
                enableHiding: false,
                header: () => <span className="p-3"></span>,
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
                                <DropdownMenuItem
                                    onClick={() => {
                                        setSelectedLabel(row.original);
                                        setIsDeleteModalOpen(true);
                                    }}
                                >
                                    <span className="text-red-500">
                                        {t("delete")}
                                    </span>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setSelectedLabel(row.original);
                                setIsEditModalOpen(true);
                            }}
                        >
                            {t("edit")}
                            <ArrowRight className="ml-2 w-4 h-4" />
                        </Button>
                    </div>
                )
            }
        ],
        [searchParams, t]
    );

    function deleteLabel(label: LabelRow) {
        startTransition(async () => {
            await api
                .delete(`/org/${orgId}/label/${label.labelId}`)
                .catch((e) => {
                    toast({
                        variant: "destructive",
                        title: t("labelErrorDelete"),
                        description: formatAxiosError(e, t("labelErrorDelete"))
                    });
                })
                .then(() => {
                    router.refresh();
                    setIsDeleteModalOpen(false);
                });
        });
    }

    return (
        <>
            {selectedLabel && (
                <>
                    <ConfirmDeleteDialog
                        open={isDeleteModalOpen}
                        setOpen={(val) => {
                            setIsDeleteModalOpen(val);
                            setSelectedLabel(null);
                        }}
                        dialog={
                            <div className="space-y-2">
                                <p>{t("labelQuestionRemove")}</p>
                                <p>{t("labelMessageRemove")}</p>
                            </div>
                        }
                        buttonText={t("labelDeleteConfirm")}
                        onConfirm={async () => deleteLabel(selectedLabel)}
                        string={selectedLabel.name}
                        title={t("labelDelete")}
                    />

                    <EditOrgLabelDialog
                        open={isEditModalOpen}
                        setOpen={setIsEditModalOpen}
                        orgId={orgId}
                        onSuccess={() =>
                            startTransition(() => router.refresh())
                        }
                        label={selectedLabel}
                    />
                </>
            )}

            <CreateOrgLabelDialog
                open={isCreateModalOpen}
                setOpen={setIsCreateModalOpen}
                orgId={orgId}
                onSuccess={() => startTransition(() => router.refresh())}
            />

            <ControlledDataTable
                columns={columns}
                rows={labels}
                addButtonText={t("labelAdd")}
                onAdd={() => setIsCreateModalOpen(true)}
                tableId="org-labels-table"
                searchPlaceholder={t("labelSearch")}
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
