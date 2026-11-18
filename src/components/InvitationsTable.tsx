"use client";

import { Timestamp } from "@app/components/Timestamp";
import { ExtendedColumnDef } from "@app/components/ui/data-table";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@app/components/ui/dropdown-menu";
import { Button } from "@app/components/ui/button";
import { MoreHorizontal } from "lucide-react";
import { InvitationsDataTable } from "@app/components/InvitationsDataTable";
import { useState } from "react";
import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import RegenerateInvitationForm from "@app/components/RegenerateInvitationForm";
import { useOrgContext } from "@app/hooks/useOrgContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import UserRoleBadges from "@app/components/UserRoleBadges";

export type InvitationRow = {
    id: string;
    email: string;
    expiresAt: string;
    roleLabels: string[];
    roleIds: number[];
};

type InvitationsTableProps = {
    invitations: InvitationRow[];
};

export default function InvitationsTable({
    invitations: i
}: InvitationsTableProps) {
    const [invitations, setInvitations] = useState<InvitationRow[]>(i);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isRegenerateModalOpen, setIsRegenerateModalOpen] = useState(false);
    const [selectedInvitation, setSelectedInvitation] =
        useState<InvitationRow | null>(null);

    const t = useTranslations();

    const api = createApiClient(useEnvContext());
    const { org } = useOrgContext();
    const router = useRouter();
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

    const columns: ExtendedColumnDef<InvitationRow>[] = [
        {
            accessorKey: "email",
            enableHiding: false,
            friendlyName: t("email"),
            header: () => <span className="p-3">{t("email")}</span>
        },
        {
            accessorKey: "expiresAt",
            friendlyName: t("expiresAt"),
            header: () => <span className="p-3">{t("expiresAt")}</span>,
            cell: ({ row }) => {
                const expiresAt = new Date(row.original.expiresAt);
                const isExpired = expiresAt < new Date();

                return (
                    <span className={isExpired ? "text-red-500" : ""}>
                        <Timestamp value={expiresAt} />
                    </span>
                );
            }
        },
        {
            id: "roles",
            accessorFn: (row) => row.roleLabels.join(", "),
            friendlyName: t("role"),
            header: () => <span className="p-3">{t("role")}</span>,
            cell: ({ row }) => (
                <UserRoleBadges roleLabels={row.original.roleLabels} />
            )
        },
        {
            id: "dots",
            enableHiding: false,
            header: () => <span className="p-3"></span>,
            cell: ({ row }) => {
                const invitation = row.original;
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
                                        setIsDeleteModalOpen(true);
                                        setSelectedInvitation(invitation);
                                    }}
                                >
                                    <span className="text-red-500">
                                        {t("inviteRemove")}
                                    </span>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>

                        <Button
                            variant={"outline"}
                            onClick={() => {
                                setIsRegenerateModalOpen(true);
                                setSelectedInvitation(invitation);
                            }}
                        >
                            {t("regenerate", { fallback: "Regenerate" })}
                        </Button>
                    </div>
                );
            }
        }
    ];

    async function removeInvitation() {
        if (selectedInvitation) {
            const res = await api
                .delete(
                    `/org/${org?.org.orgId}/invitations/${selectedInvitation.id}`
                )
                .catch((e) => {
                    toast({
                        variant: "destructive",
                        title: t("inviteRemoveError"),
                        description: t("inviteRemoveErrorDescription")
                    });
                });

            if (res && res.status === 200) {
                toast({
                    variant: "default",
                    title: t("inviteRemoved"),
                    description: t("inviteRemovedDescription", {
                        email: selectedInvitation.email
                    })
                });

                setInvitations((prev) =>
                    prev.filter(
                        (invitation) => invitation.id !== selectedInvitation.id
                    )
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
                    setSelectedInvitation(null);
                }}
                dialog={
                    <div className="space-y-2">
                        <p>{t("inviteQuestionRemove")}</p>
                        <p>{t("inviteMessageRemove")}</p>
                    </div>
                }
                buttonText={t("inviteRemoveConfirm")}
                onConfirm={removeInvitation}
                string={selectedInvitation?.email ?? ""}
                title={t("inviteRemove")}
            />
            <RegenerateInvitationForm
                open={isRegenerateModalOpen}
                setOpen={setIsRegenerateModalOpen}
                invitation={selectedInvitation}
                onRegenerate={(updatedInvitation) => {
                    setInvitations((prev) =>
                        prev.map((inv) =>
                            inv.id === updatedInvitation.id
                                ? updatedInvitation
                                : inv
                        )
                    );
                }}
            />

            <InvitationsDataTable
                columns={columns}
                data={invitations}
                onRefresh={refreshData}
                isRefreshing={isRefreshing}
            />
        </>
    );
}
