"use client";

import { ColumnDef } from "@tanstack/react-table";
import { ExtendedColumnDef } from "@app/components/ui/data-table";
import { ShareLinksDataTable } from "@app/components/ShareLinksDataTable";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@app/components/ui/dropdown-menu";
import { Button } from "@app/components/ui/button";
import {
    Copy,
    ArrowRight,
    ArrowUpDown,
    MoreHorizontal,
    Check,
    ArrowUpRight,
    ShieldOff,
    ShieldCheck
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
// import CreateResourceForm from "./CreateResourceForm";
import { useState } from "react";
import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import { formatAxiosError } from "@app/lib/api";
import { toast } from "@app/hooks/useToast";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { ArrayElement } from "@server/types/ArrayElement";
import { ListAccessTokensResponse } from "@server/routers/accessToken";
import moment from "moment";
import CreateShareLinkForm from "@app/components/CreateShareLinkForm";
import { constructShareLink } from "@app/lib/shareLinks";
import { useTranslations } from "next-intl";
import { getUserDisplayName } from "@app/lib/getUserDisplayName";

export type ShareLinkRow = {
    accessTokenId: string;
    resourceId: number;
    resourceName: string;
    resourceNiceId: string;
    title: string | null;
    createdAt: number;
    expiresAt: number | null;
    userId?: string | null;
    userName?: string | null;
    username?: string | null;
    userEmail?: string | null;
};

type ShareLinksTableProps = {
    shareLinks: ShareLinkRow[];
    orgId: string;
};

export default function ShareLinksTable({
    shareLinks,
    orgId
}: ShareLinksTableProps) {
    const router = useRouter();
    const t = useTranslations();

    const api = createApiClient(useEnvContext());

    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [selectedLink, setSelectedLink] = useState<ShareLinkRow | null>(null);
    const [rows, setRows] = useState<ShareLinkRow[]>(shareLinks);

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

    function formatLink(link: string) {
        return link.substring(0, 20) + "..." + link.substring(link.length - 20);
    }

    async function deleteSharelink(id: string) {
        await api.delete(`/access-token/${id}`).catch((e) => {
            toast({
                title: t("shareErrorDelete"),
                description: formatAxiosError(e, t("shareErrorDeleteMessage"))
            });
            throw e;
        });

        const newRows = rows.filter((r) => r.accessTokenId !== id);
        setRows(newRows);

        toast({
            title: t("shareDeleted"),
            description: t("shareDeletedDescription")
        });
    }

    const columns: ExtendedColumnDef<ShareLinkRow>[] = [
        {
            accessorKey: "title",
            friendlyName: t("title"),
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("title")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            }
        },
        {
            accessorKey: "resourceName",
            enableHiding: false,
            friendlyName: t("resource"),
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("resource")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => {
                const r = row.original;
                return (
                    <Link
                        href={`/${orgId}/settings/resources/public/${r.resourceNiceId}`}
                    >
                        <Button variant="outline" size="sm">
                            {r.resourceName}
                            <ArrowUpRight className="ml-2 h-3 w-3" />
                        </Button>
                    </Link>
                );
            }
        },
        {
            accessorKey: "userId",
            friendlyName: t("user"),
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("user")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
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
        // {
        //     accessorKey: "domain",
        //     header: "Link",
        //     cell: ({ row }) => {
        //         const r = row.original;
        //
        //         const link = constructShareLink(
        //             r.resourceId,
        //             r.accessTokenId,
        //             r.tokenHash
        //         );
        //
        //         return (
        //             <div className="flex items-center">
        //                 <Link
        //                     href={link}
        //                     target="_blank"
        //                     rel="noopener noreferrer"
        //                     className="hover:underline mr-2"
        //                 >
        //                     {formatLink(link)}
        //                 </Link>
        //                 <Button
        //                     variant="ghost"
        //                     className="h-6 w-6 p-0"
        //                     onClick={() => {
        //                         navigator.clipboard.writeText(link);
        //                         const originalIcon = document.querySelector(
        //                             `#icon-${r.accessTokenId}`
        //                         );
        //                         if (originalIcon) {
        //                             originalIcon.classList.add("hidden");
        //                         }
        //                         const checkIcon = document.querySelector(
        //                             `#check-icon-${r.accessTokenId}`
        //                         );
        //                         if (checkIcon) {
        //                             checkIcon.classList.remove("hidden");
        //                             setTimeout(() => {
        //                                 checkIcon.classList.add("hidden");
        //                                 if (originalIcon) {
        //                                     originalIcon.classList.remove(
        //                                         "hidden"
        //                                     );
        //                                 }
        //                             }, 2000);
        //                         }
        //                     }}
        //                 >
        //                     <Copy
        //                         id={`icon-${r.accessTokenId}`}
        //                         className="h-4 w-4"
        //                     />
        //                     <Check
        //                         id={`check-icon-${r.accessTokenId}`}
        //                         className="hidden text-green-500 h-4 w-4"
        //                     />
        //                     <span className="sr-only">Copy link</span>
        //                 </Button>
        //             </div>
        //         );
        //     }
        // },
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
            cell: ({ row }) => {
                const r = row.original;
                return moment(r.createdAt).format("lll");
            }
        },
        {
            accessorKey: "expiresAt",
            friendlyName: t("expires"),
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("expires")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => {
                const r = row.original;
                if (r.expiresAt) {
                    return moment(r.expiresAt).format("lll");
                }
                return t("never");
            }
        },
        {
            id: "delete",
            enableHiding: false,
            header: () => <span className="p-3"></span>,
            cell: ({ row }) => {
                const resourceRow = row.original;
                return (
                    <div className="flex items-center space-x-2 justify-end">
                        {/* <DropdownMenu> */}
                        {/*     <DropdownMenuTrigger asChild> */}
                        {/*         <Button variant="ghost" className="h-8 w-8 p-0"> */}
                        {/*             <span className="sr-only"> */}
                        {/*                 {t("openMenu")} */}
                        {/*             </span> */}
                        {/*             <MoreHorizontal className="h-4 w-4" /> */}
                        {/*         </Button> */}
                        {/*     </DropdownMenuTrigger> */}
                        {/*     <DropdownMenuContent align="end"> */}
                        {/*         <DropdownMenuItem */}
                        {/*             onClick={() => { */}
                        {/*                 deleteSharelink( */}
                        {/*                     resourceRow.accessTokenId */}
                        {/*                 ); */}
                        {/*             }} */}
                        {/*         > */}
                        {/*             <button className="text-red-500"> */}
                        {/*                 {t("delete")} */}
                        {/*             </button> */}
                        {/*         </DropdownMenuItem> */}
                        {/*     </DropdownMenuContent> */}
                        {/* </DropdownMenu> */}
                        <Button
                            variant={"outline"}
                            onClick={() => {
                                setSelectedLink(resourceRow);
                                setIsDeleteModalOpen(true);
                            }}
                        >
                            {t("delete")}
                        </Button>
                    </div>
                );
            }
        }
    ];

    return (
        <>
            {selectedLink && (
                <ConfirmDeleteDialog
                    open={isDeleteModalOpen}
                    setOpen={(val) => {
                        setIsDeleteModalOpen(val);
                        if (!val) setSelectedLink(null);
                    }}
                    dialog={
                        <div className="space-y-2">
                            <p>{t("shareQuestionRemove")}</p>
                            <p>{t("shareMessageRemove")}</p>
                        </div>
                    }
                    buttonText={t("shareDeleteConfirm")}
                    onConfirm={async () =>
                        deleteSharelink(selectedLink.accessTokenId)
                    }
                    string={selectedLink.title || selectedLink.resourceName}
                    title={t("shareDelete")}
                />
            )}

            <CreateShareLinkForm
                open={isCreateModalOpen}
                setOpen={setIsCreateModalOpen}
                onCreated={(val) => {
                    setRows([val, ...rows]);
                }}
            />

            <ShareLinksDataTable
                columns={columns}
                data={rows}
                createShareLink={() => {
                    setIsCreateModalOpen(true);
                }}
                onRefresh={refreshData}
                isRefreshing={isRefreshing}
            />
        </>
    );
}
