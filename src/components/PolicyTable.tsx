"use client";

import { PolicyDataTable } from "@app/components/PolicyDataTable";
import { Button } from "@app/components/ui/button";
import { ExtendedColumnDef } from "@app/components/ui/data-table";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@app/components/ui/dropdown-menu";
import {
    JitSyncRows,
    OrgMappingSummary,
    RoleMappingSummary
} from "@app/components/IdpMappingSummary";
import { ArrowUpDown, MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";

export interface PolicyRow {
    orgId: string;
    roleMapping?: string;
    orgMapping?: string;
    createMissingRoles?: boolean;
    syncRoleMapping?: string | null;
    syncOrgMapping?: string | null;
    syncCreateMissingRoles?: boolean;
    mappingsLinked?: boolean;
}

interface Props {
    policies: PolicyRow[];
    onDelete: (orgId: string) => void;
    onAdd: () => void;
    onEdit: (policy: PolicyRow) => void;
}

export default function PolicyTable({
    policies,
    onDelete,
    onAdd,
    onEdit
}: Props) {
    const t = useTranslations();
    const columns: ExtendedColumnDef<PolicyRow>[] = [
        {
            accessorKey: "orgId",
            enableHiding: false,
            friendlyName: t("orgId"),
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("orgId")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            }
        },
        {
            accessorKey: "roleMapping",
            friendlyName: t("roleMapping"),
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("roleMapping")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => {
                const policy = row.original;
                return (
                    <JitSyncRows
                        linked={policy.mappingsLinked !== false}
                        jit={
                            <RoleMappingSummary
                                roleMapping={policy.roleMapping}
                                createMissingRoles={policy.createMissingRoles}
                            />
                        }
                        sync={
                            <RoleMappingSummary
                                roleMapping={policy.syncRoleMapping}
                                createMissingRoles={
                                    policy.syncCreateMissingRoles
                                }
                            />
                        }
                    />
                );
            }
        },
        {
            accessorKey: "orgMapping",
            friendlyName: t("orgMapping"),
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("orgMapping")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => {
                const policy = row.original;
                return (
                    <JitSyncRows
                        linked={policy.mappingsLinked !== false}
                        jit={<OrgMappingSummary orgMapping={policy.orgMapping} />}
                        sync={
                            <OrgMappingSummary
                                orgMapping={policy.syncOrgMapping}
                            />
                        }
                    />
                );
            }
        },
        {
            id: "actions",
            enableHiding: false,
            header: () => <span className="p-3"></span>,
            cell: ({ row }) => {
                const policy = row.original;
                return (
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
                                        onDelete(policy.orgId);
                                    }}
                                >
                                    <span className="text-red-500">
                                        {t("delete")}
                                    </span>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                            variant={"outline"}
                            onClick={() => onEdit(policy)}
                        >
                            {t("edit")}
                        </Button>
                    </div>
                );
            }
        }
    ];

    return <PolicyDataTable columns={columns} data={policies} onAdd={onAdd} />;
}
