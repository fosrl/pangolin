"use client";

import { ExtendedColumnDef } from "@app/components/ui/data-table";
import { VirtualApiKeysDataTable } from "@app/components/VirtualApiKeysDataTable";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@app/components/ui/dropdown-menu";
import { Button } from "@app/components/ui/button";
import { Badge } from "@app/components/ui/badge";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
import {
    ArrowRight,
    ArrowUpDown,
    ArrowUpRight,
    Funnel,
    MoreHorizontal
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import { formatAxiosError, createApiClient } from "@app/lib/api";
import { toast } from "@app/hooks/useToast";
import { useEnvContext } from "@app/hooks/useEnvContext";
import moment from "moment";
import CreateVirtualApiKeyForm, {
    type CreatedVirtualApiKey
} from "@app/components/CreateVirtualApiKeyForm";
import EditVirtualApiKeyForm from "@app/components/EditVirtualApiKeyForm";
import ViewVirtualApiKeySecret from "@app/components/ViewVirtualApiKeySecret";
import CopyToClipboard from "@app/components/CopyToClipboard";
import { useTranslations } from "next-intl";
import { getUserDisplayName } from "@app/lib/getUserDisplayName";
import { UserSelector, type SelectedUser } from "@app/components/user-selector";
import {
    ResourceSelector,
    type SelectedResource
} from "@app/components/resource-selector";
import { cn } from "@app/lib/cn";
import { dataTableFilterPopoverContentClassName } from "@app/lib/dataTableFilterPopover";
import type { GetVirtualApiKeyResponse } from "@server/routers/virtualApiKey/types";
import {
    formatVirtualApiKeyCredential,
    formatVirtualApiKeyPreview
} from "@app/lib/virtualApiKeyFormat";
import { AxiosResponse } from "axios";

export type VirtualApiKeyRow = CreatedVirtualApiKey;

type VirtualApiKeysTableProps = {
    virtualApiKeys: VirtualApiKeyRow[];
    orgId: string;
};

export default function VirtualApiKeysTable({
    virtualApiKeys,
    orgId
}: VirtualApiKeysTableProps) {
    const router = useRouter();
    const t = useTranslations();
    const api = createApiClient(useEnvContext());

    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isViewSecretOpen, setIsViewSecretOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [selectedKey, setSelectedKey] = useState<VirtualApiKeyRow | null>(
        null
    );
    const [rows, setRows] = useState<VirtualApiKeyRow[]>(virtualApiKeys);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const [userFilterOpen, setUserFilterOpen] = useState(false);
    const [resourceFilterOpen, setResourceFilterOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<SelectedUser | null>(null);
    const [selectedResource, setSelectedResource] =
        useState<SelectedResource | null>(null);
    const [unassignedOnly, setUnassignedOnly] = useState(false);

    useEffect(() => {
        setRows(virtualApiKeys);
    }, [virtualApiKeys]);

    const filteredRows = useMemo(() => {
        return rows.filter((row) => {
            if (unassignedOnly && row.userId) {
                return false;
            }
            if (selectedUser && row.userId !== selectedUser.id) {
                return false;
            }
            if (selectedResource) {
                if (
                    !row.allResources &&
                    !row.resourceIds.includes(selectedResource.resourceId)
                ) {
                    return false;
                }
            }
            return true;
        });
    }, [rows, selectedUser, selectedResource, unassignedOnly]);

    const refreshData = async () => {
        setIsRefreshing(true);
        try {
            await new Promise((resolve) => setTimeout(resolve, 200));
            router.refresh();
        } catch {
            toast({
                title: t("error"),
                description: t("refreshError"),
                variant: "destructive"
            });
        } finally {
            setIsRefreshing(false);
        }
    };

    async function deleteKey(id: string) {
        await api.delete(`/virtual-api-key/${id}`).catch((e) => {
            toast({
                title: t("virtualApiKeysErrorDelete"),
                description: formatAxiosError(
                    e,
                    t("virtualApiKeysErrorDeleteMessage")
                )
            });
            throw e;
        });

        setRows((prev) => prev.filter((r) => r.virtualApiKeyId !== id));

        toast({
            title: t("virtualApiKeysDeleted"),
            description: t("virtualApiKeysDeletedDescription")
        });
    }

    const clearUserFilter = () => {
        setSelectedUser(null);
        setUnassignedOnly(false);
        setUserFilterOpen(false);
    };

    const clearResourceFilter = () => {
        setSelectedResource(null);
        setResourceFilterOpen(false);
    };

    const columns: ExtendedColumnDef<VirtualApiKeyRow>[] = [
        {
            accessorKey: "name",
            enableHiding: false,
            friendlyName: t("virtualApiKeysName"),
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("virtualApiKeysName")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => row.original.name || "-"
        },
        {
            id: "resources",
            accessorFn: (row) => row.resourceNames,
            friendlyName: t("resource"),
            header: () => (
                <Popover
                    open={resourceFilterOpen}
                    onOpenChange={setResourceFilterOpen}
                >
                    <PopoverTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            role="combobox"
                            className={cn(
                                "justify-between text-sm h-8 px-2 w-full p-3",
                                !selectedResource && "text-muted-foreground"
                            )}
                        >
                            <div className="flex items-center gap-2 min-w-0">
                                {t("resource")}
                                <Funnel className="size-4 flex-none" />
                                {selectedResource && (
                                    <Badge
                                        className="truncate max-w-[10rem]"
                                        variant="secondary"
                                    >
                                        {selectedResource.name}
                                    </Badge>
                                )}
                            </div>
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent
                        className={dataTableFilterPopoverContentClassName}
                        align="start"
                    >
                        <ResourceSelector
                            orgId={orgId}
                            selectedResource={selectedResource}
                            showClear={!!selectedResource}
                            onClear={clearResourceFilter}
                            protocol="inference"
                            onSelectResource={(resource) => {
                                setSelectedResource(resource);
                                setResourceFilterOpen(false);
                            }}
                        />
                    </PopoverContent>
                </Popover>
            ),
            cell: ({ row }) => {
                const r = row.original;
                if (r.allResources) {
                    return t("virtualApiKeysAllResources");
                }
                if (r.resources.length === 0) {
                    return <span>{t("virtualApiKeysNoResources")}</span>;
                }
                if (r.resources.length === 1) {
                    const resource = r.resources[0];
                    if (!resource.niceId) {
                        return resource.name;
                    }
                    return (
                        <Link
                            href={`/${orgId}/settings/resources/public/${resource.niceId}`}
                        >
                            <Button variant="outline" size="sm">
                                {resource.name}
                                <ArrowUpRight className="ml-2 h-3 w-3" />
                            </Button>
                        </Link>
                    );
                }
                return r.resourceNames;
            }
        },
        {
            accessorKey: "userId",
            friendlyName: t("user"),
            header: () => (
                <Popover open={userFilterOpen} onOpenChange={setUserFilterOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            role="combobox"
                            className={cn(
                                "justify-between text-sm h-8 px-2 w-full p-3",
                                !selectedUser &&
                                    !unassignedOnly &&
                                    "text-muted-foreground"
                            )}
                        >
                            <div className="flex items-center gap-2 min-w-0">
                                {t("user")}
                                <Funnel className="size-4 flex-none" />
                                {(selectedUser || unassignedOnly) && (
                                    <Badge
                                        className="truncate max-w-[10rem]"
                                        variant="secondary"
                                    >
                                        {unassignedOnly
                                            ? t(
                                                  "virtualApiKeysFilterUnassigned"
                                              )
                                            : selectedUser?.text}
                                    </Badge>
                                )}
                            </div>
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent
                        className={dataTableFilterPopoverContentClassName}
                        align="start"
                    >
                        <UserSelector
                            orgId={orgId}
                            selectedUser={selectedUser}
                            allowClear={false}
                            showClear={!!selectedUser || unassignedOnly}
                            onClear={clearUserFilter}
                            unassignedOption={{
                                label: t("virtualApiKeysFilterUnassigned"),
                                selected: unassignedOnly,
                                onSelect: () => {
                                    setSelectedUser(null);
                                    setUnassignedOnly(true);
                                    setUserFilterOpen(false);
                                }
                            }}
                            onSelectUser={(user) => {
                                setSelectedUser(user);
                                setUnassignedOnly(false);
                                setUserFilterOpen(false);
                            }}
                        />
                    </PopoverContent>
                </Popover>
            ),
            cell: ({ row }) => {
                const r = row.original;
                if (!r.userId) {
                    return <span>-</span>;
                }
                return (
                    <Link href={`/${orgId}/settings/access/users/${r.userId}`}>
                        <Button variant="outline" size="sm">
                            {getUserDisplayName({
                                email: r.userEmail,
                                name: r.userName,
                                username: r.username
                            })}
                            <ArrowUpRight className="ml-2 h-3 w-3" />
                        </Button>
                    </Link>
                );
            }
        },
        {
            accessorKey: "lastChars",
            friendlyName: t("virtualApiKeysSecret"),
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("virtualApiKeysSecret")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => (
                <VirtualApiKeySecretCell
                    virtualApiKeyId={row.original.virtualApiKeyId}
                    lastChars={row.original.lastChars}
                />
            )
        },
        {
            accessorKey: "createdAt",
            friendlyName: t("created"),
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("created")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => moment(row.original.createdAt).format("lll")
        },
        {
            id: "actions",
            enableHiding: false,
            header: () => <span className="p-3"></span>,
            cell: ({ row }) => {
                const keyRow = row.original;
                return (
                    <div className="flex items-center justify-end gap-2">
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
                                        setSelectedKey(keyRow);
                                        setIsViewSecretOpen(true);
                                    }}
                                >
                                    {t("virtualApiKeysViewSecret")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={() => {
                                        setSelectedKey(keyRow);
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
                                setSelectedKey(keyRow);
                                setIsEditModalOpen(true);
                            }}
                        >
                            {t("edit")}
                        </Button>
                    </div>
                );
            }
        }
    ];

    return (
        <>
            {selectedKey && (
                <ConfirmDeleteDialog
                    open={isDeleteModalOpen}
                    setOpen={(val) => {
                        setIsDeleteModalOpen(val);
                        if (!val) setSelectedKey(null);
                    }}
                    dialog={
                        <div className="space-y-2">
                            <p>{t("virtualApiKeysQuestionRemove")}</p>
                            <p>{t("virtualApiKeysMessageRemove")}</p>
                        </div>
                    }
                    buttonText={t("virtualApiKeysDeleteConfirm")}
                    onConfirm={async () =>
                        deleteKey(selectedKey.virtualApiKeyId)
                    }
                    string={selectedKey.name || selectedKey.virtualApiKeyId}
                    title={t("virtualApiKeysDelete")}
                />
            )}

            <ViewVirtualApiKeySecret
                open={isViewSecretOpen}
                setOpen={(val) => {
                    setIsViewSecretOpen(val);
                    if (!val) setSelectedKey(null);
                }}
                virtualApiKeyId={selectedKey?.virtualApiKeyId ?? null}
                name={selectedKey?.name}
            />

            <CreateVirtualApiKeyForm
                open={isCreateModalOpen}
                setOpen={setIsCreateModalOpen}
                onCreated={(val) => {
                    setRows([val, ...rows]);
                }}
            />

            <EditVirtualApiKeyForm
                open={isEditModalOpen}
                setOpen={(val) => {
                    setIsEditModalOpen(val);
                    if (!val) setSelectedKey(null);
                }}
                virtualApiKey={selectedKey}
                onUpdated={(val) => {
                    setRows((prev) =>
                        prev.map((row) =>
                            row.virtualApiKeyId === val.virtualApiKeyId
                                ? val
                                : row
                        )
                    );
                }}
            />

            <VirtualApiKeysDataTable
                columns={columns}
                data={filteredRows}
                createVirtualApiKey={() => {
                    setIsCreateModalOpen(true);
                }}
                onRefresh={refreshData}
                isRefreshing={isRefreshing}
            />
        </>
    );
}

function VirtualApiKeySecretCell({
    virtualApiKeyId,
    lastChars
}: {
    virtualApiKeyId: string;
    lastChars: string;
}) {
    const t = useTranslations();
    const api = createApiClient(useEnvContext());
    const preview = formatVirtualApiKeyPreview(virtualApiKeyId, lastChars);
    const [credential, setCredential] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        api.get<AxiosResponse<GetVirtualApiKeyResponse>>(
            `/virtual-api-key/${virtualApiKeyId}`
        )
            .then((res) => {
                if (cancelled) {
                    return;
                }
                const secret = res.data.data.virtualApiKey.secret;
                if (secret) {
                    setCredential(
                        formatVirtualApiKeyCredential(virtualApiKeyId, secret)
                    );
                }
            })
            .catch((e) => {
                if (cancelled) {
                    return;
                }
                toast({
                    variant: "destructive",
                    title: t("virtualApiKeysErrorFetchSecret"),
                    description: formatAxiosError(
                        e,
                        t("virtualApiKeysErrorFetchSecretDescription")
                    )
                });
            });

        return () => {
            cancelled = true;
        };
    }, [virtualApiKeyId]);

    return (
        <CopyToClipboard text={credential ?? preview} displayText={preview} />
    );
}
