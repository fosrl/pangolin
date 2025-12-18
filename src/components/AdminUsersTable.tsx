"use client";

import { ColumnDef } from "@tanstack/react-table";
import { ExtendedColumnDef } from "@app/components/ui/data-table";
import { UsersDataTable } from "@app/components/AdminUsersDataTable";
import { Button } from "@app/components/ui/button";
import { ArrowRight, ArrowUpDown, MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import { toast } from "@app/hooks/useToast";
import { formatAxiosError } from "@app/lib/api";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useTranslations } from "next-intl";
import {
    DropdownMenu,
    DropdownMenuItem,
    DropdownMenuContent,
    DropdownMenuTrigger
} from "@app/components/ui/dropdown-menu";
import {
    Credenza,
    CredenzaContent,
    CredenzaDescription,
    CredenzaHeader,
    CredenzaTitle,
    CredenzaBody,
    CredenzaFooter,
    CredenzaClose
} from "@app/components/Credenza";
import CopyToClipboard from "@app/components/CopyToClipboard";
import { AxiosResponse } from "axios";

export type GlobalUserRow = {
    id: string;
    name: string | null;
    username: string;
    email: string | null;
    type: string;
    idpId: number | null;
    idpName: string;
    dateCreated: string;
    twoFactorEnabled: boolean | null;
    twoFactorSetupRequested: boolean | null;
};

type Props = {
    users: GlobalUserRow[];
};

type AdminGeneratePasswordResetCodeResponse = {
    token: string;
    email: string;
    url: string;
};

export default function UsersTable({ users }: Props) {
    const router = useRouter();
    const t = useTranslations();

    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [selected, setSelected] = useState<GlobalUserRow | null>(null);
    const [rows, setRows] = useState<GlobalUserRow[]>(users);

    const api = createApiClient(useEnvContext());

    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isPasswordResetCodeDialogOpen, setIsPasswordResetCodeDialogOpen] =
        useState(false);
    const [passwordResetCodeData, setPasswordResetCodeData] =
        useState<AdminGeneratePasswordResetCodeResponse | null>(null);
    const [isGeneratingCode, setIsGeneratingCode] = useState(false);

    // Update local state when props change (e.g., after refresh)
    useEffect(() => {
        setRows(users);
    }, [users]);

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

    const deleteUser = (id: string) => {
        api.delete(`/user/${id}`)
            .catch((e) => {
                console.error(t("userErrorDelete"), e);
                toast({
                    variant: "destructive",
                    title: t("userErrorDelete"),
                    description: formatAxiosError(e, t("userErrorDelete"))
                });
            })
            .then(() => {
                router.refresh();
                setIsDeleteModalOpen(false);

                const newRows = rows.filter((row) => row.id !== id);

                setRows(newRows);
            });
    };

    const generatePasswordResetCode = async (userId: string) => {
        setIsGeneratingCode(true);
        try {
            const res = await api.post<
                AxiosResponse<AdminGeneratePasswordResetCodeResponse>
            >(`/user/${userId}/generate-password-reset-code`);

            if (res.data?.data) {
                setPasswordResetCodeData(res.data.data);
                setIsPasswordResetCodeDialogOpen(true);
            }
        } catch (e) {
            console.error("Failed to generate password reset code", e);
            toast({
                variant: "destructive",
                title: t("error"),
                description: formatAxiosError(e, t("errorOccurred"))
            });
        } finally {
            setIsGeneratingCode(false);
        }
    };

    const columns: ExtendedColumnDef<GlobalUserRow>[] = [
        {
            accessorKey: "id",
            friendlyName: "ID",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        ID
                    </Button>
                );
            }
        },
        {
            accessorKey: "username",
            enableHiding: false,
            friendlyName: t("username"),
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
            accessorKey: "email",
            friendlyName: t("email"),
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("email")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            }
        },
        {
            accessorKey: "name",
            friendlyName: t("name"),
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("name")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            }
        },
        {
            accessorKey: "idpName",
            friendlyName: t("identityProvider"),
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
            }
        },
        {
            accessorKey: "twoFactorEnabled",
            friendlyName: t("twoFactor"),
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("twoFactor")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => {
                const userRow = row.original;

                return (
                    <div className="flex flex-row items-center gap-2">
                        <span>
                            {userRow.twoFactorEnabled ||
                            userRow.twoFactorSetupRequested ? (
                                <span className="text-green-500">
                                    {t("enabled")}
                                </span>
                            ) : (
                                <span>{t("disabled")}</span>
                            )}
                        </span>
                    </div>
                );
            }
        },
        {
            id: "actions",
            enableHiding: false,
            header: () => <span className="p-3"></span>,
            cell: ({ row }) => {
                const r = row.original;
                return (
                    <div className="flex items-center gap-2 justify-end">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="h-8 w-8 p-0">
                                    <span className="sr-only">Open menu</span>
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                {r.type === "internal" && (
                                    <DropdownMenuItem
                                        onClick={() => {
                                            generatePasswordResetCode(r.id);
                                        }}
                                    >
                                        {t("generatePasswordResetCode")}
                                    </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                    onClick={() => {
                                        setSelected(r);
                                        setIsDeleteModalOpen(true);
                                    }}
                                >
                                    {t("delete")}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                            variant={"outline"}
                            onClick={() => {
                                router.push(`/admin/users/${r.id}`);
                            }}
                        >
                            {t("edit")}
                            <ArrowRight className="ml-2 w-4 h-4" />
                        </Button>
                    </div>
                );
            }
        }
    ];

    return (
        <>
            {selected && (
                <ConfirmDeleteDialog
                    open={isDeleteModalOpen}
                    setOpen={(val) => {
                        setIsDeleteModalOpen(val);
                        setSelected(null);
                    }}
                    dialog={
                        <div className="space-y-2">
                            <p>
                                {t("userQuestionRemove", {
                                    selectedUser:
                                        selected?.email ||
                                        selected?.name ||
                                        selected?.username
                                })}
                            </p>

                            <p>
                                <b>{t("userMessageRemove")}</b>
                            </p>

                            <p>{t("userMessageConfirm")}</p>
                        </div>
                    }
                    buttonText={t("userDeleteConfirm")}
                    onConfirm={async () => deleteUser(selected!.id)}
                    string={
                        selected.email || selected.name || selected.username
                    }
                    title={t("userDeleteServer")}
                />
            )}

            <UsersDataTable
                columns={columns}
                data={rows}
                onRefresh={refreshData}
                isRefreshing={isRefreshing}
            />

            <Credenza
                open={isPasswordResetCodeDialogOpen}
                onOpenChange={setIsPasswordResetCodeDialogOpen}
            >
                <CredenzaContent>
                    <CredenzaHeader>
                        <CredenzaTitle>
                            {t("passwordResetCodeGenerated")}
                        </CredenzaTitle>
                        <CredenzaDescription>
                            {t("passwordResetCodeGeneratedDescription")}
                        </CredenzaDescription>
                    </CredenzaHeader>
                    <CredenzaBody>
                        {passwordResetCodeData && (
                            <div className="space-y-4">
                                <div>
                                    <label className="text-sm font-medium mb-2 block">
                                        {t("email")}
                                    </label>
                                    <CopyToClipboard
                                        text={passwordResetCodeData.email}
                                    />
                                </div>
                                <div>
                                    <label className="text-sm font-medium mb-2 block">
                                        {t("passwordResetCode")}
                                    </label>
                                    <CopyToClipboard
                                        text={passwordResetCodeData.token}
                                    />
                                </div>
                                <div>
                                    <label className="text-sm font-medium mb-2 block">
                                        {t("passwordResetUrl")}
                                    </label>
                                    <CopyToClipboard
                                        text={passwordResetCodeData.url}
                                        isLink={true}
                                    />
                                </div>
                            </div>
                        )}
                    </CredenzaBody>
                    <CredenzaFooter>
                        <CredenzaClose asChild>
                            <Button variant="outline">{t("close")}</Button>
                        </CredenzaClose>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>
        </>
    );
}
