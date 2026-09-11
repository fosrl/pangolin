"use client";

import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import { ColumnFilterButton } from "@app/components/ColumnFilterButton";
import { Button } from "@app/components/ui/button";
import {
    ControlledDataTable,
    type ExtendedColumnDef
} from "@app/components/ui/controlled-data-table";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useNavigationContext } from "@app/hooks/useNavigationContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { getUserDisplayName } from "@app/lib/getUserDisplayName";
import { getNextSortOrder, getSortDirection } from "@app/lib/sortColumn";
import { type PaginationState } from "@tanstack/react-table";
import {
    ArrowDown01Icon,
    ArrowRight,
    ArrowUp10Icon,
    ChevronsUpDownIcon,
    MoreHorizontal,
    ShieldUserIcon
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useDebouncedCallback } from "use-debounce";
import z from "zod";
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
import { Badge } from "./ui/badge";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "./ui/tooltip";
import { useUserContext } from "@app/hooks/useUserContext";

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
    serverAdmin?: boolean;
};

type FilterOption = { value: string; label: string };

type Props = {
    users: GlobalUserRow[];
    pagination: PaginationState;
    rowCount: number;
    idpFilterOptions: FilterOption[];
};

type AdminGeneratePasswordResetCodeResponse = {
    token: string;
    email: string;
    url: string;
};

export default function UsersTable({
    users,
    pagination,
    rowCount,
    idpFilterOptions
}: Props) {
    const router = useRouter();
    const t = useTranslations();
    const api = createApiClient(useEnvContext());

    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [selected, setSelected] = useState<GlobalUserRow | null>(null);
    const [isPasswordResetCodeDialogOpen, setIsPasswordResetCodeDialogOpen] =
        useState(false);
    const [passwordResetCodeData, setPasswordResetCodeData] =
        useState<AdminGeneratePasswordResetCodeResponse | null>(null);
    const [isGeneratingCode, setIsGeneratingCode] = useState(false);
    const [isPromoteModalOpen, setIsPromoteModalOpen] = useState(false);
    const [promoting, setPromoting] = useState<GlobalUserRow | null>(null);
    const [isDemoteModalOpen, setIsDemoteModalOpen] = useState(false);
    const [demoting, setDemoting] = useState<GlobalUserRow | null>(null);
    const user = useUserContext();

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

    const twoFactorFilterSchema = z
        .enum(["true", "false"])
        .optional()
        .catch(undefined);

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

    const deleteUser = (id: string) => {
        startTransition(() => {
            void api
                .delete(`/user/${id}`)
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
                    setSelected(null);
                });
        });
    };

    const generatePasswordResetCode = async (userId: string) => {
        setIsGeneratingCode(true);
        try {
            const res = await api.post(
                `/user/${userId}/generate-password-reset-code`
            );

            const envelope = res.data as {
                data?: AdminGeneratePasswordResetCodeResponse;
            };
            if (envelope?.data) {
                setPasswordResetCodeData(envelope.data);
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

    const setServerAdmin = async (
        targetUser: GlobalUserRow,
        serverAdmin: boolean
    ) => {
        const successTitleKey = serverAdmin
            ? "promoteServerAdminSuccess"
            : "demoteServerAdminSuccess";
        const successDescriptionKey = serverAdmin
            ? "promoteServerAdminSuccessDescription"
            : "demoteServerAdminSuccessDescription";
        const errorKey = serverAdmin
            ? "promoteServerAdminError"
            : "demoteServerAdminError";

        try {
            await api.post(`/user/${targetUser.id}/server-admin`, {
                serverAdmin
            });

            toast({
                title: t(successTitleKey),
                description: t(successDescriptionKey, {
                    selectedUser: getUserDisplayName({
                        email: targetUser.email,
                        name: targetUser.name,
                        username: targetUser.username
                    })
                })
            });

            startTransition(() => {
                router.refresh();
            });
        } catch (e) {
            console.error(t(errorKey), e);
            toast({
                variant: "destructive",
                title: t(errorKey),
                description: formatAxiosError(e, t(errorKey))
            });
        } finally {
            setIsPromoteModalOpen(false);
            setPromoting(null);
            setIsDemoteModalOpen(false);
            setDemoting(null);
        }
    };

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

    const columns: ExtendedColumnDef<GlobalUserRow>[] = [
        {
            accessorKey: "id",
            friendlyName: "ID",
            header: () => <span className="p-3">ID</span>
        },
        {
            accessorKey: "username",
            enableHiding: false,
            friendlyName: t("username"),
            header: () => {
                const sortOrder = getSortDirection("username", searchParams);
                const Icon =
                    sortOrder === "asc"
                        ? ArrowDown01Icon
                        : sortOrder === "desc"
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
                    {row.original.username}{" "}
                    {row.original.id === user.user.userId && (
                        <>
                            <span className="text-muted-foreground">
                                &middot;
                            </span>{" "}
                            <span className="text-primary">you</span>
                        </>
                    )}
                    {row.original.serverAdmin && (
                        <>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <ShieldUserIcon className="text-primary size-5 flex-none" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {t("serverAdmin")}
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            {/*  <Badge>{t("serverAdmin")}</Badge> */}
                        </>
                    )}
                </span>
            )
        },
        {
            accessorKey: "email",
            friendlyName: t("email"),
            header: () => {
                const sortOrder = getSortDirection("email", searchParams);
                const Icon =
                    sortOrder === "asc"
                        ? ArrowDown01Icon
                        : sortOrder === "desc"
                          ? ArrowUp10Icon
                          : ChevronsUpDownIcon;
                return (
                    <Button
                        variant="ghost"
                        className="p-3"
                        onClick={() => toggleSort("email")}
                    >
                        {t("email")}
                        <Icon className="ml-2 h-4 w-4" />
                    </Button>
                );
            }
        },
        {
            accessorKey: "name",
            friendlyName: t("name"),
            header: () => {
                const sortOrder = getSortDirection("name", searchParams);
                const Icon =
                    sortOrder === "asc"
                        ? ArrowDown01Icon
                        : sortOrder === "desc"
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
            }
        },
        {
            accessorKey: "idpName",
            friendlyName: t("identityProvider"),
            header: () => (
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
            )
        },
        {
            accessorKey: "twoFactorEnabled",
            friendlyName: t("twoFactor"),
            header: () => (
                <ColumnFilterButton
                    options={[
                        { value: "true", label: t("enabled") },
                        { value: "false", label: t("disabled") }
                    ]}
                    selectedValue={twoFactorFilterSchema.parse(
                        searchParams.get("two_factor") ?? undefined
                    )}
                    onValueChange={(value) =>
                        handleFilterChange("two_factor", value)
                    }
                    searchPlaceholder={t("searchPlaceholder")}
                    emptyMessage={t("emptySearchOptions")}
                    label={t("twoFactor")}
                    className="p-3"
                />
            ),
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
                                        disabled={isGeneratingCode}
                                        onClick={() => {
                                            void generatePasswordResetCode(
                                                r.id
                                            );
                                        }}
                                    >
                                        {t("generatePasswordResetCode")}
                                    </DropdownMenuItem>
                                )}
                                {!r.serverAdmin && (
                                    <DropdownMenuItem
                                        onClick={() => {
                                            setPromoting(r);
                                            setIsPromoteModalOpen(true);
                                        }}
                                    >
                                        {t("promoteServerAdmin")}
                                    </DropdownMenuItem>
                                )}
                                {r.serverAdmin && r.id !== user.user.userId && (
                                    <DropdownMenuItem
                                        onClick={() => {
                                            setDemoting(r);
                                            setIsDemoteModalOpen(true);
                                        }}
                                    >
                                        {t("demoteServerAdmin")}
                                    </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                    onClick={() => {
                                        setSelected(r);
                                        setIsDeleteModalOpen(true);
                                    }}
                                    className="text-red-400"
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
                                    selectedUser: selected
                                        ? getUserDisplayName({
                                              email: selected.email,
                                              name: selected.name,
                                              username: selected.username
                                          })
                                        : ""
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
                    string={getUserDisplayName({
                        email: selected.email,
                        name: selected.name,
                        username: selected.username
                    })}
                    title={t("userDeleteServer")}
                />
            )}

            {promoting && (
                <ConfirmDeleteDialog
                    open={isPromoteModalOpen}
                    setOpen={(val) => {
                        setIsPromoteModalOpen(val);
                        if (!val) {
                            setPromoting(null);
                        }
                    }}
                    dialog={
                        <div className="space-y-2">
                            <p>
                                {t("promoteServerAdminQuestion", {
                                    selectedUser: getUserDisplayName({
                                        email: promoting.email,
                                        name: promoting.name,
                                        username: promoting.username
                                    })
                                })}
                            </p>

                            <p>{t("promoteServerAdminMessage")}</p>
                        </div>
                    }
                    buttonText={t("promoteServerAdminConfirm")}
                    onConfirm={async () => setServerAdmin(promoting, true)}
                    string={getUserDisplayName({
                        email: promoting.email,
                        name: promoting.name,
                        username: promoting.username
                    })}
                    warningText={t("promoteServerAdminWarning")}
                    title={t("promoteServerAdminTitle")}
                />
            )}

            {demoting && (
                <ConfirmDeleteDialog
                    open={isDemoteModalOpen}
                    setOpen={(val) => {
                        setIsDemoteModalOpen(val);
                        if (!val) {
                            setDemoting(null);
                        }
                    }}
                    dialog={
                        <div className="space-y-2">
                            <p>
                                {t("demoteServerAdminQuestion", {
                                    selectedUser: getUserDisplayName({
                                        email: demoting.email,
                                        name: demoting.name,
                                        username: demoting.username
                                    })
                                })}
                            </p>

                            <p>
                                {t("demoteServerAdminMessage", {
                                    selectedUser: getUserDisplayName({
                                        email: demoting.email,
                                        name: demoting.name,
                                        username: demoting.username
                                    })
                                })}
                            </p>
                        </div>
                    }
                    buttonText={t("demoteServerAdminConfirm")}
                    onConfirm={async () => setServerAdmin(demoting, false)}
                    string={getUserDisplayName({
                        email: demoting.email,
                        name: demoting.name,
                        username: demoting.username
                    })}
                    warningText={t("demoteServerAdminWarning")}
                    title={t("demoteServerAdminTitle")}
                />
            )}

            <ControlledDataTable
                columns={columns}
                rows={users}
                tableId="admin-users-table"
                searchPlaceholder={t("userSearch")}
                pagination={pagination}
                onPaginationChange={handlePaginationChange}
                searchQuery={searchParams.get("query")?.toString()}
                onSearch={handleSearchChange}
                onRefresh={refreshData}
                isRefreshing={isRefreshing || isFiltering}
                rowCount={rowCount}
                enableColumnVisibility
                stickyLeftColumn="username"
                stickyRightColumn="actions"
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
