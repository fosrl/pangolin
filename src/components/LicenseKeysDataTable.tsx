"use client";

import { ExtendedColumnDef } from "@app/components/ui/data-table";
import { DataTable } from "@app/components/ui/data-table";
import { Button } from "@app/components/ui/button";
import { Badge } from "@app/components/ui/badge";
import { LicenseKeyCache } from "@server/license/license";
import { ArrowUpDown } from "lucide-react";
import CopyToClipboard from "@app/components/CopyToClipboard";
import { useTranslations } from "next-intl";
import moment from "moment";

type LicenseKeysDataTableProps = {
    licenseKeys: LicenseKeyCache[];
    onDelete: (key: LicenseKeyCache) => void;
    onCreate: () => void;
};

function obfuscateLicenseKey(key: string): string {
    if (key.length <= 8) return key;
    const firstPart = key.substring(0, 4);
    const lastPart = key.substring(key.length - 4);
    return `${firstPart}••••••••••••••••••••${lastPart}`;
}

export function LicenseKeysDataTable({
    licenseKeys,
    onDelete,
    onCreate
}: LicenseKeysDataTableProps) {
    const t = useTranslations();

    const columns: ExtendedColumnDef<LicenseKeyCache>[] = [
        {
            accessorKey: "licenseKey",
            enableHiding: false,
            friendlyName: t("licenseKey"),
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("licenseKey")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => {
                const licenseKey = row.original.licenseKey;
                return (
                    <CopyToClipboard
                        text={licenseKey}
                        displayText={obfuscateLicenseKey(licenseKey)}
                    />
                );
            }
        },
        {
            accessorKey: "valid",
            friendlyName: t("valid"),
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("valid")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => {
                return row.original.valid ? (
                    <Badge variant="green">{t("yes")}</Badge>
                ) : (
                    <Badge variant="red">{t("no")}</Badge>
                );
            }
        },
        {
            accessorKey: "tier",
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
                const tier = row.original.tier;
                switch (tier) {
                    case "enterprise":
                        return t("licenseTierEnterprise");
                    case "tier1":
                        return t("licenseTierTier1");
                    case "tier2":
                        return t("licenseTierTier2");
                    default:
                        return t("licenseTierPersonal");
                }
            }
        },
        {
            accessorKey: "quantity",
            friendlyName: t("users"),
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("users")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => {
                const quantity = row.original.quantity;
                if (quantity === undefined) {
                    return "-";
                }
                return quantity < 0 ? t("licenseUnlimited") : quantity;
            }
        },
        {
            accessorKey: "quantity_2",
            friendlyName: t("sites"),
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("sites")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => {
                const quantity = row.original.quantity_2;
                if (quantity === undefined) {
                    return "-";
                }
                return quantity < 0 ? t("licenseUnlimited") : quantity;
            }
        },
        {
            accessorKey: "terminateAt",
            friendlyName: t("licenseTableValidUntil"),
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("licenseTableValidUntil")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => {
                const termianteAt = row.original.terminateAt;
                return moment(termianteAt).format("lll");
            }
        },
        {
            id: "delete",
            enableHiding: false,
            header: () => <span className="p-3"></span>,
            cell: ({ row }) => (
                <div className="flex items-center gap-2 justify-end">
                    <Button
                        variant={"outline"}
                        onClick={() => onDelete(row.original)}
                    >
                        {t("delete")}
                    </Button>
                </div>
            )
        }
    ];

    return (
        <DataTable
            columns={columns}
            data={licenseKeys}
            persistPageSize="licenseKeys-table"
            title={t("licenseKeys")}
            searchPlaceholder={t("licenseKeySearch")}
            searchColumn="licenseKey"
            defaultSort={{ id: "terminateAt", desc: false }}
            onAdd={onCreate}
            addButtonText={t("licenseKeyAdd")}
            enableColumnVisibility={true}
            stickyLeftColumn="licenseKey"
            stickyRightColumn="delete"
        />
    );
}
