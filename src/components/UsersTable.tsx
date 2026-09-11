"use client";

import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import { Button } from "@app/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@app/components/ui/dropdown-menu";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useNavigationContext } from "@app/hooks/useNavigationContext";
import { useOrgContext } from "@app/hooks/useOrgContext";
import { toast } from "@app/hooks/useToast";
import { useUserContext } from "@app/hooks/useUserContext";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { getUserDisplayName } from "@app/lib/getUserDisplayName";
import { getNextSortOrder, getSortDirection } from "@app/lib/sortColumn";
import { type PaginationState } from "@tanstack/react-table";
import {
    ArrowDown01Icon,
    ArrowRight,
    ArrowUp10Icon,
    ChevronsUpDownIcon,
    MoreHorizontal
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { useDebouncedCallback } from "use-debounce";
import z from "zod";
import { ColumnFilterButton } from "./ColumnFilterButton";
import { ColumnMultiFilterButton } from "./ColumnMultiFilterButton";
import IdpTypeBadge from "./IdpTypeBadge";
import {
    ControlledDataTable,
    type ExtendedColumnDef
} from "./ui/controlled-data-table";
import UserRoleBadges from "./UserRoleBadges";

export type UserRow = {
    id: string;
    email: string | null;
    displayUsername: string | null;
    username: string;
    name: string | null;
    idpId: number | null;
    idpName: string;
    type: string;
    idpVariant: string | null;
    status: string;
    roleLabels: string[];
    isOwner: boolean;
};

type FilterOption = { value: string; label: string };

type UsersTableProps = {
    users: UserRow[];
    pagination: PaginationState;
    rowCount: number;
    idpFilterOptions: FilterOption[];
    roleFilterOptions: FilterOption[];
};

export default function UsersTable({
    users,
    pagination,
    rowCount,
    idpFilterOptions,
    roleFilterOptions
}: UsersTableProps) {
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
    const router = useRouter();
    const api = createApiClient(useEnvContext());
    const { user } = useUserContext();
    const { org } = useOrgContext();
    const t = useTranslations();
    const [isNavigatingToAddPage, startNavigation] = useTransition();
    const [isRefreshing, startTransition] = useTransition();
    const {
        navigate: filter,
        isNavigating: isFiltering,
        searchParams,
        pathname
    } = useNavigationContext();

    const idpIdParamSchema = z
        .union([z.literal("internal"), z.string().regex(/^\d+$/)])
        .optional()
        .catch(undefined);

    const roleIdsFromSearchParams = useMemo(() => {
        const sp = new URLSearchParams(searchParams);
        return [
            ...new Set(sp.getAll("role_id").filter((id) => /^\d+$/.test(id)))
        ];
    }, [searchParams.toString()]);

    const isRemovingSelf = useMemo(() => {
        if (!selectedUser || !user) return false;
        return (
            `${selectedUser.username}-${selectedUser.idpId}` ===
            `${user.username}-${user.idpId}`
        );
    }, [selectedUser, user]);

    function handleFilterChange(
        column: string,
        value: string | undefined | null
    ) {
        const sp = new URLSearchParams(searchParams);
        sp.delete(column);
        sp.delete("page");

        if (value) {
            sp.set(column, value);
        }
        startTransition(() => router.push(`${pathname}?${sp.toString()}`));
    }

    function handleRoleIdsChange(values: string[]) {
        const sp = new URLSearchParams(searchParams);
        sp.delete("role_id");
        sp.delete("page");
        for (const id of values) {
            if (/^\d+$/.test(id)) {
                sp.append("role_id", id);
            }
        }
        startTransition(() => router.push(`${pathname}?${sp.toString()}`));
    }

    const refreshData = async () => {
        startTransition(async () => {
            try {
                await new Promise((resolve) => setTimeout(resolve, 200));
                router.refresh();
            } catch (error) {
                toast({
                    title: t("error"),
                    description: t("refreshError"),
                    variant: "destructive"
                });
            }
        });
    };

    const columns: ExtendedColumnDef<UserRow>[] = [
        {
            accessorKey: "displayUsername",
            enableHiding: false,
            friendlyName: t("username"),
            header: ({ column }) => {
                const nameOrder = getSortDirection("username", searchParams);
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
                        onClick={() => toggleSort("username")}
                    >
                        {t("username")}
                        <Icon className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => (
                <span className="inline-flex gap-1 items-center">
                    {row.original.displayUsername}{" "}
                    {row.original.id === user.userId && (
                        <>
                            <span className="text-muted-foreground">
                                &middot;
                            </span>{" "}
                            <span className="text-primary">you</span>
                        </>
                    )}
                </span>
            )
        },
        {
            accessorKey: "idpName",
            friendlyName: t("identityProvider"),
            header: () => {
                return (
                    <ColumnFilterButton
                        options={idpFilterOptions}
                        selectedValue={idpIdParamSchema.parse(
                            searchParams.get("idp_id") ?? undefined
                        )}
                        onValueChange={(value) =>
                            handleFilterChange("idp_id", value)
                        }
                        searchPlaceholder={t("searchPlaceholder")}
                        emptyMessage={t("emptySearchOptions")}
                        label={t("identityProvider")}
                        className="p-3"
                    />
                );
            },
            cell: ({ row }) => {
                const userRow = row.original;
                return (
                    <IdpTypeBadge
                        type={userRow.type}
                        name={userRow.idpName}
                        variant={userRow.idpVariant || undefined}
                    />
                );
            }
        },
        {
            id: "role",
            accessorFn: (row) => row.roleLabels.join(", "),
            friendlyName: t("role"),
            header: () => {
                return (
                    <ColumnMultiFilterButton
                        options={roleFilterOptions}
                        selectedValues={roleIdsFromSearchParams}
                        onSelectedValuesChange={handleRoleIdsChange}
                        searchPlaceholder={t("searchPlaceholder")}
                        emptyMessage={t("emptySearchOptions")}
                        label={t("role")}
                        className="p-3"
                    />
                );
            },
            cell: ({ row }) => {
                return <UserRoleBadges roleLabels={row.original.roleLabels} />;
            }
        },
        {
            id: "actions",
            enableHiding: false,
            header: () => <span className="p-3"></span>,
            cell: ({ row }) => {
                const userRow = row.original;
                const canRemoveFromOrg = !userRow.isOwner;
                return (
                    <div className="flex items-center justify-end">
                        <div>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        className="h-8 w-8 p-0"
                                    >
                                        <span className="sr-only">
                                            {t("openMenu")}
                                        </span>
                                        <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <Link
                                        href={`/${org?.org.orgId}/settings/access/users/${userRow.id}`}
                                        className="block w-full"
                                    >
                                        <DropdownMenuItem>
                                            {t("accessUserManage")}
                                        </DropdownMenuItem>
                                    </Link>
                                    {canRemoveFromOrg && (
                                        <DropdownMenuItem
                                            onClick={() => {
                                                setIsDeleteModalOpen(true);
                                                setSelectedUser(userRow);
                                            }}
                                        >
                                            <span className="text-red-500">
                                                {t("accessUserRemove")}
                                            </span>
                                        </DropdownMenuItem>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                        <Link
                            href={`/${org?.org.orgId}/settings/access/users/${userRow.id}`}
                        >
                            <Button variant={"outline"} className="ml-2">
                                {t("manage")}
                                <ArrowRight className="ml-2 w-4 h-4" />
                            </Button>
                        </Link>
                    </div>
                );
            }
        }
    ];

    async function removeUser() {
        if (selectedUser) {
            const res = await api
                .delete(`/org/${org!.org.orgId}/user/${selectedUser.id}`)
                .catch((e) => {
                    toast({
                        variant: "destructive",
                        title: t("userErrorOrgRemove"),
                        description: formatAxiosError(
                            e,
                            t("userErrorOrgRemoveDescription")
                        )
                    });
                });

            if (res && res.status === 200) {
                toast({
                    variant: "default",
                    title: t("userOrgRemoved"),
                    description: t("userOrgRemovedDescription", {
                        email: selectedUser.email || ""
                    })
                });
            }
        }
        router.refresh();
        setIsDeleteModalOpen(false);
    }

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
            <ConfirmDeleteDialog
                open={isDeleteModalOpen}
                setOpen={(val) => {
                    setIsDeleteModalOpen(val);
                    setSelectedUser(null);
                }}
                dialog={
                    <div className="space-y-2">
                        <p>
                            {t(
                                isRemovingSelf
                                    ? "userQuestionOrgRemoveSelf"
                                    : "userQuestionOrgRemove"
                            )}
                        </p>
                        <p>
                            {t(
                                isRemovingSelf
                                    ? "userMessageOrgRemoveSelf"
                                    : "userMessageOrgRemove"
                            )}
                        </p>
                    </div>
                }
                buttonText={t(
                    isRemovingSelf
                        ? "userRemoveOrgConfirmSelf"
                        : "userRemoveOrgConfirm"
                )}
                warningText={
                    isRemovingSelf ? t("userRemoveOrgSelfWarning") : undefined
                }
                onConfirm={async () => startTransition(removeUser)}
                string={
                    isRemovingSelf
                        ? t("userRemoveOrgConfirmPhraseSelf")
                        : selectedUser
                          ? getUserDisplayName({
                                email: selectedUser.email,
                                name: selectedUser.name,
                                username: selectedUser.username
                            })
                          : ""
                }
                title={t(
                    isRemovingSelf ? "userRemoveOrgSelf" : "userRemoveOrg"
                )}
            />

            <ControlledDataTable
                columns={columns}
                pagination={pagination}
                rowCount={rowCount}
                isNavigatingToAddPage={isNavigatingToAddPage}
                addButtonText={t("accessUserCreate")}
                searchQuery={searchParams.get("query")?.toString()}
                onSearch={handleSearchChange}
                onPaginationChange={handlePaginationChange}
                rows={users}
                searchPlaceholder={t("accessUsersSearch")}
                tableId="users-table"
                onAdd={() => {
                    startNavigation(() =>
                        router.push(
                            `/${org?.org.orgId}/settings/access/users/create`
                        )
                    );
                }}
                onRefresh={refreshData}
                isRefreshing={isRefreshing || isFiltering}
            />
        </>
    );
}
