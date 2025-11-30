"use client";

import { ColumnDef } from "@tanstack/react-table";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@app/components/ui/dropdown-menu";
import { Button } from "@app/components/ui/button";
import { ArrowRight, ArrowUpDown, Crown, MoreHorizontal } from "lucide-react";
import { UsersDataTable } from "@app/components/UsersDataTable";
import { useState } from "react";
import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import { useOrgContext } from "@app/hooks/useOrgContext";
import { toast } from "@app/hooks/useToast";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatAxiosError } from "@app/lib/api";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useUserContext } from "@app/hooks/useUserContext";
import { useTranslations } from "next-intl";
import IdpTypeBadge from "./IdpTypeBadge";

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
    role: string;
    isOwner: boolean;
};

type UsersTableProps = {
    users: UserRow[];
};

export default function UsersTable({ users: u }: UsersTableProps) {
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
    const [users, setUsers] = useState<UserRow[]>(u);
    const router = useRouter();
    const api = createApiClient(useEnvContext());
    const { user, updateUser } = useUserContext();
    const { org } = useOrgContext();
    const t = useTranslations();
    const [isRefreshing, setIsRefreshing] = useState(false);

    const refreshData = async () => {
        console.log("Data refreshed");
        setIsRefreshing(true);
        try {
            await new Promise((resolve) => setTimeout(resolve, 200));
            router.refresh();
        } catch (error) {
            toast({
                title: t("error"),
                description: t("refreshError"),
                variant: "destructive"
            });
        } finally {
            setIsRefreshing(false);
        }
    };

    const columns: ColumnDef<UserRow>[] = [
        {
            accessorKey: "displayUsername",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("username")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            }
        },
        {
            accessorKey: "idpName",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("identityProvider")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
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
            accessorKey: "role",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("role")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => {
                const userRow = row.original;

                return (
                    <div className="flex flex-row items-center gap-2">
                        {userRow.isOwner && (
                            <Crown className="w-4 h-4 text-yellow-600" />
                        )}
                        <span>{userRow.role}</span>
                    </div>
                );
            }
        },
        {
            id: "actions",
            cell: ({ row }) => {
                const userRow = row.original;
                return (
                    <div className="flex items-center justify-end">
                        <>
                            <div>
                                {userRow.isOwner && (
                                    <MoreHorizontal className="h-4 w-4 opacity-0" />
                                )}
                                {!userRow.isOwner && (
                                    <>
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
                                                        {t("accessUsersManage")}
                                                    </DropdownMenuItem>
                                                </Link>
                                                {`${userRow.username}-${userRow.idpId}` !==
                                                    `${user?.username}-${user?.idpId}` && (
                                                    <DropdownMenuItem
                                                        onClick={() => {
                                                            setIsDeleteModalOpen(
                                                                true
                                                            );
                                                            setSelectedUser(
                                                                userRow
                                                            );
                                                        }}
                                                    >
                                                        <span className="text-red-500">
                                                            {t(
                                                                "accessUserRemove"
                                                            )}
                                                        </span>
                                                    </DropdownMenuItem>
                                                )}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </>
                                )}
                            </div>
                        </>
                        {userRow.isOwner && (
                            <Button
                                variant={"secondary"}
                                className="ml-2"
                                size="sm"
                                disabled={true}
                            >
                                {t("manage")}
                                <ArrowRight className="ml-2 w-4 h-4" />
                            </Button>
                        )}
                        {!userRow.isOwner && (
                            <Link
                                href={`/${org?.org.orgId}/settings/access/users/${userRow.id}`}
                            >
                                <Button
                                    variant={"secondary"}
                                    className="ml-2"
                                    size="sm"
                                    disabled={userRow.isOwner}
                                >
                                    {t("manage")}
                                    <ArrowRight className="ml-2 w-4 h-4" />
                                </Button>
                            </Link>
                        )}
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

                setUsers((prev) =>
                    prev.filter((u) => u.id !== selectedUser?.id)
                );
            }
        }
        setIsDeleteModalOpen(false);
    }

    return (
        <>
            <ConfirmDeleteDialog
                open={isDeleteModalOpen}
                setOpen={(val) => {
                    setIsDeleteModalOpen(val);
                    setSelectedUser(null);
                }}
                dialog={
                    <div>
                        <p>
                            {t("userQuestionOrgRemove")}
                        </p>
                        <p>{t("userMessageOrgRemove")}</p>
                    </div>
                }
                buttonText={t("userRemoveOrgConfirm")}
                onConfirm={removeUser}
                string={
                    selectedUser?.email ||
                    selectedUser?.name ||
                    selectedUser?.username ||
                    ""
                }
                title={t("userRemoveOrg")}
            />

            <UsersDataTable
                columns={columns}
                data={users}
                inviteUser={() => {
                    router.push(
                        `/${org?.org.orgId}/settings/access/users/create`
                    );
                }}
                onRefresh={refreshData}
                isRefreshing={isRefreshing}
            />
        </>
    );
}
