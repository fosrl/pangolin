"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowUpDown, MoreHorizontal } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@app/components/ui/alert";
import { DataTable, ExtendedColumnDef } from "@app/components/ui/data-table";
import { Button } from "@app/components/ui/button";
import { Badge } from "@app/components/ui/badge";
import { Switch } from "@app/components/ui/switch";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@app/components/ui/dropdown-menu";
import CopyToClipboard from "@app/components/CopyToClipboard";
import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import CustomDnsRecordCredenza from "@app/components/CustomDnsRecordCredenza";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { domainQueries } from "@app/lib/queries";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { CustomDnsRecordRow } from "@server/routers/customDnsRecord/types";

type Props = {
    orgId: string;
    domainId: string;
    baseDomain: string;
    // The DNS server only serves custom records for verified domains
    verified: boolean;
};

function formatValue(record: CustomDnsRecordRow, value: string): string {
    if (record.type === "MX") {
        return `${record.priority} ${value}`;
    }
    if (record.type === "SRV") {
        return `${record.priority} ${record.weight} ${record.port} ${value}`;
    }
    return value;
}

export default function CustomDnsRecordsTable({
    orgId,
    domainId,
    baseDomain,
    verified
}: Props) {
    const t = useTranslations();
    const api = createApiClient(useEnvContext());
    const { isPaidUser } = usePaidStatus();
    const isDisabled = !isPaidUser(tierMatrix.customDnsRecords);

    const {
        data: records = [],
        isRefetching,
        refetch
    } = useQuery(domainQueries.listCustomDnsRecords({ orgId, domainId }));

    const [editorOpen, setEditorOpen] = useState(false);
    const [editingRecord, setEditingRecord] =
        useState<CustomDnsRecordRow | null>(null);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [deletingRecord, setDeletingRecord] =
        useState<CustomDnsRecordRow | null>(null);

    function openEditor(record: CustomDnsRecordRow | null) {
        setEditingRecord(record);
        setEditorOpen(true);
    }

    async function toggleEnabled(record: CustomDnsRecordRow, enabled: boolean) {
        try {
            await api.post(
                `/org/${orgId}/domain/${domainId}/custom-dns-record/${record.customDnsRecordId}`,
                { enabled }
            );
            refetch();
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("customDnsRecordSaveError"),
                description: formatAxiosError(e)
            });
        }
    }

    async function deleteRecord() {
        if (!deletingRecord) {
            return;
        }
        try {
            await api.delete(
                `/org/${orgId}/domain/${domainId}/custom-dns-record/${deletingRecord.customDnsRecordId}`
            );
            toast({ title: t("customDnsRecordDeleted") });
            setDeleteOpen(false);
            setDeletingRecord(null);
            refetch();
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("customDnsRecordDeleteError"),
                description: formatAxiosError(e)
            });
        }
    }

    const columns: ExtendedColumnDef<CustomDnsRecordRow>[] = [
        {
            accessorKey: "fullDomain",
            enableHiding: false,
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
            },
            cell: ({ row }) => {
                const fullDomain = row.original.fullDomain;
                return (
                    <CopyToClipboard
                        text={fullDomain}
                        displayText={fullDomain}
                        isLink={false}
                    />
                );
            }
        },
        {
            accessorKey: "type",
            friendlyName: t("type"),
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("type")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => {
                return <Badge variant="secondary">{row.original.type}</Badge>;
            }
        },
        {
            accessorKey: "values",
            friendlyName: t("value"),
            header: () => <span className="p-3">{t("value")}</span>,
            cell: ({ row }) => {
                const record = row.original;
                return (
                    <div className="flex flex-col gap-1 max-w-md">
                        {record.values.map((value) => (
                            <span key={value} className="break-all">
                                {formatValue(record, value)}
                            </span>
                        ))}
                    </div>
                );
            }
        },
        {
            accessorKey: "ttl",
            friendlyName: t("TTL"),
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("TTL")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            }
        },
        {
            accessorKey: "enabled",
            friendlyName: t("enabled"),
            header: () => <span className="p-3">{t("enabled")}</span>,
            cell: ({ row }) => {
                const record = row.original;
                return (
                    <Switch
                        checked={record.enabled}
                        disabled={isDisabled}
                        onCheckedChange={(checked) =>
                            toggleEnabled(record, checked)
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
                const record = row.original;
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
                                    disabled={isDisabled}
                                    onClick={() => {
                                        setDeletingRecord(record);
                                        setDeleteOpen(true);
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
                            disabled={isDisabled}
                            onClick={() => openEditor(record)}
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
            <PaidFeaturesAlert tiers={tierMatrix.customDnsRecords} />

            {!verified && (
                <Alert variant="warning">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>
                        {t("customDnsRecordsUnverifiedTitle")}
                    </AlertTitle>
                    <AlertDescription>
                        {t("customDnsRecordsUnverifiedDescription")}
                    </AlertDescription>
                </Alert>
            )}

            {deletingRecord && !isDisabled && (
                <ConfirmDeleteDialog
                    open={deleteOpen}
                    setOpen={(open) => {
                        setDeleteOpen(open);
                        if (!open) {
                            setDeletingRecord(null);
                        }
                    }}
                    string={deletingRecord.fullDomain}
                    title={t("customDnsRecordDeleteTitle")}
                    dialog={
                        <p>
                            {t("customDnsRecordDeleteQuestion", {
                                type: deletingRecord.type,
                                name: deletingRecord.fullDomain
                            })}
                        </p>
                    }
                    buttonText={t("customDnsRecordDeleteConfirm")}
                    onConfirm={deleteRecord}
                />
            )}

            <CustomDnsRecordCredenza
                open={editorOpen && !isDisabled}
                setOpen={setEditorOpen}
                orgId={orgId}
                domainId={domainId}
                baseDomain={baseDomain}
                record={editingRecord}
                onSaved={() => refetch()}
            />

            <DataTable
                columns={columns}
                data={records}
                persistPageSize="custom-dns-records-table"
                title={t("customDnsRecords")}
                searchPlaceholder={t("customDnsRecordsSearch")}
                searchColumn="fullDomain"
                addButtonText={t("customDnsRecordsAdd")}
                onAdd={() => openEditor(null)}
                addButtonDisabled={isDisabled}
                onRefresh={refetch}
                isRefreshing={isRefetching}
                enableColumnVisibility={true}
                stickyLeftColumn="fullDomain"
                stickyRightColumn="actions"
            />
        </>
    );
}
