"use client";

import { ColumnDef } from "@tanstack/react-table";
import { ExtendedColumnDef } from "@app/components/ui/data-table";
import { useTranslations } from "next-intl";
import { Badge } from "@app/components/ui/badge";
import { DNSRecordsDataTable } from "./DNSRecordsDataTable";
import CopyToClipboard from "@app/components/CopyToClipboard";
import { useEnvContext } from "@app/hooks/useEnvContext";

export type DNSRecordRow = {
    id: string;
    recordType: string; // "NS" | "CNAME" | "A" | "TXT"
    baseDomain: string | null;
    value: string;
    verified?: boolean;
};

type Props = {
    records: DNSRecordRow[];
    type: string | null;
};

export default function DNSRecordsTable({ records, type }: Props) {
    const t = useTranslations();
    const env = useEnvContext();

    const statusColumn: ColumnDef<DNSRecordRow> = {
        accessorKey: "verified",
        header: () => <span className="p-3">{t("status")}</span>,
        cell: ({ row }) => {
            const verified = row.original.verified;
            return verified ? (
                type === "wildcard" ? (
                    <Badge variant="outlinePrimary">
                        {t("manual", { fallback: "Manual" })}
                    </Badge>
                ) : (
                    <Badge variant="green">{t("verified")}</Badge>
                )
            ) : (
                <Badge variant="yellow">
                    {t("pending", { fallback: "Pending" })}
                </Badge>
            );
        }
    };

    const columns: ExtendedColumnDef<DNSRecordRow>[] = [
        {
            accessorKey: "baseDomain",
            friendlyName: t("recordName", { fallback: "Record name" }),
            header: () => (
                <span className="p-3">
                    {t("recordName", { fallback: "Record name" })}
                </span>
            ),
            cell: ({ row }) => {
                const baseDomain = row.original.baseDomain;
                return baseDomain ? (
                    <CopyToClipboard
                        text={baseDomain}
                        displayText={baseDomain}
                        isLink={false}
                    />
                ) : (
                    <div>-</div>
                );
            }
        },
        {
            accessorKey: "recordType",
            friendlyName: t("type"),
            header: () => <span className="p-3">{t("type")}</span>,
            cell: ({ row }) => {
                const type = row.original.recordType;
                return <div className="">{type}</div>;
            }
        },
        {
            accessorKey: "ttl",
            friendlyName: t("TTL"),
            header: () => <span className="p-3">{t("TTL")}</span>,
            cell: ({ row }) => {
                return <div>{t("auto")}</div>;
            }
        },
        {
            accessorKey: "value",
            friendlyName: t("value"),
            header: () => <span className="p-3">{t("value")}</span>,
            cell: ({ row }) => {
                const value = row.original.value;
                return (
                    <CopyToClipboard
                        text={value}
                        displayText={value}
                        isLink={false}
                    />
                );
            }
        },
        ...(env.env.flags.usePangolinDns ? [statusColumn] : [])
    ];

    return <DNSRecordsDataTable columns={columns} data={records} type={type} />;
}
