"use client";

import DeleteRoleForm from "@app/components/DeleteRoleForm";
import { Button } from "@app/components/ui/button";
import { ExtendedColumnDef } from "@app/components/ui/data-table";
import { useNavigationContext } from "@app/hooks/useNavigationContext";
import { toast } from "@app/hooks/useToast";
import { getNextSortOrder, getSortDirection } from "@app/lib/sortColumn";
import { Role } from "@server/db";
import type { PaginationState } from "@tanstack/react-table";
import {
    ArrowDown01Icon,
    ArrowUp10Icon,
    ChevronsUpDownIcon,
    MoreHorizontal
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useDebouncedCallback } from "use-debounce";
import { ControlledDataTable } from "./ui/controlled-data-table";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "./ui/dropdown-menu";

export type RoleRow = Role;

type RolesTableProps = {
    roles: RoleRow[];
    pagination: PaginationState;
    rowCount: number;
};

export default function UsersTable({
    roles,
    pagination,
    rowCount
}: RolesTableProps) {
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const router = useRouter();
    const { orgId } = useParams();
    const [isRefreshing, startTransition] = useTransition();
    const {
        navigate: filter,
        isNavigating: isFiltering,
        searchParams
    } = useNavigationContext();

    const [roleToRemove, setRoleToRemove] = useState<RoleRow | null>(null);

    const t = useTranslations();

    const refreshData = async () => {
        console.log("Data refreshed");
        try {
            router.refresh();
        } catch (error) {
            toast({
                title: t("error"),
                description: t("refreshError"),
                variant: "destructive"
            });
        }
    };

    const columns: ExtendedColumnDef<RoleRow>[] = [
        {
            accessorKey: "name",
            enableHiding: false,
            friendlyName: t("name"),
            header: ({ column }) => {
                const nameOrder = getSortDirection("name", searchParams);
                const Icon =
                    nameOrder === "asc"
                        ? ArrowDown01Icon
                        : nameOrder === "desc"
                          ? ArrowUp10Icon
                          : ChevronsUpDownIcon;
                return (
                    <Button variant="ghost" onClick={() => toggleSort("name")}>
                        {t("name")}
                        <Icon className="ml-2 h-4 w-4" />
                    </Button>
                );
            }
        },
        {
            accessorKey: "description",
            friendlyName: t("description"),
            header: () => <span className="p-3">{t("description")}</span>
        },
        // {
        //     id: "actions",
        //     enableHiding: false,
        //     header: () => <span className="p-3"></span>,
        //     cell: ({ row }) => {
        //         const roleRow = row.original;

        //         return (
        //             <div className="flex items-center gap-2 justify-end">
        //                 <Button
        //                     variant={"outline"}
        //                     disabled={roleRow.isAdmin || false}
        //                     onClick={() => {
        //                         setIsDeleteModalOpen(true);
        //                         setUserToRemove(roleRow);
        //                     }}
        //                 >
        //                     {t("accessRoleDelete")}
        //                 </Button>
        //             </div>
        //         );
        //     }
        // },
        {
            id: "actions",
            enableHiding: false,
            header: () => <span className="p-3"></span>,
            cell: ({ row }) => {
                const roleRow = row.original;
                const isAdmin = roleRow.isAdmin;
                return (
                    <div className="flex items-center gap-2 justify-end">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    className="h-8 w-8 p-0"
                                    disabled={isAdmin || false}
                                >
                                    <span className="sr-only">
                                        {t("openMenu")}
                                    </span>
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                    disabled={isAdmin || false}
                                    onClick={() => {
                                        setRoleToRemove(roleRow);
                                        setIsDeleteModalOpen(true);
                                    }}
                                >
                                    <span className="text-red-500">
                                        {t("delete")}
                                    </span>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Button variant={"outline"} asChild>
                            <Link
                                href={`/${orgId}/settings/access/roles/${roleRow.roleId}`}
                            >
                                {t("edit")}
                            </Link>
                        </Button>
                    </div>
                );
            }
        }
    ];

    function toggleSort(column: string) {
        const newSearch = getNextSortOrder(column, searchParams);

        filter({
            searchParams: newSearch
        });
    }

    const handlePaginationChange = (newPage: PaginationState) => {
        searchParams.set("page", (newPage.pageIndex + 1).toString());
        searchParams.set("pageSize", newPage.pageSize.toString());
        filter({
            searchParams
        });
    };

    const handleSearchChange = useDebouncedCallback((query: string) => {
        searchParams.set("query", query);
        searchParams.delete("page");
        filter({
            searchParams
        });
    }, 300);

    return (
        <>
            {roleToRemove && (
                <DeleteRoleForm
                    open={isDeleteModalOpen}
                    setOpen={setIsDeleteModalOpen}
                    roleToDelete={roleToRemove}
                    afterDelete={() => {
                        startTransition(async () => {
                            await refreshData().then(() =>
                                setRoleToRemove(null)
                            );
                        });
                    }}
                />
            )}

            <ControlledDataTable
                columns={columns}
                rows={roles}
                tableId="roles-table"
                searchQuery={searchParams.get("query")?.toString()}
                onSearch={handleSearchChange}
                onPaginationChange={handlePaginationChange}
                searchPlaceholder={t("accessRolesSearch")}
                addButtonText={t("accessRolesAdd")}
                rowCount={rowCount}
                pagination={pagination}
                onAdd={() => {
                    router.push(`/${orgId}/settings/access/roles/create`);
                }}
                onRefresh={() => startTransition(refreshData)}
                isRefreshing={isRefreshing}
            />
        </>
    );
}
