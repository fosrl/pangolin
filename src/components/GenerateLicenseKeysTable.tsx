"use client";

import { useTranslations } from "next-intl";
import { ColumnDef } from "@tanstack/react-table";
import { ExtendedColumnDef } from "@app/components/ui/data-table";
import { Button } from "./ui/button";
import { ArrowUpDown, MoreHorizontal } from "lucide-react";
import CopyToClipboard from "./CopyToClipboard";
import { Badge } from "./ui/badge";
import moment from "moment";
import { DataTable } from "./ui/data-table";
import { GeneratedLicenseKey } from "@server/routers/generatedLicense/types";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import NewPricingLicenseForm from "./NewPricingLicenseForm";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@app/components/ui/dropdown-menu";

type GnerateLicenseKeysTableProps = {
    licenseKeys: GeneratedLicenseKey[];
    orgId: string;
};

function obfuscateLicenseKey(key: string): string {
    if (key.length <= 8) return key;
    const firstPart = key.substring(0, 4);
    const lastPart = key.substring(key.length - 4);
    return `${firstPart}••••••••••••••••••••${lastPart}`;
}

const GENERATE_QUERY = "generate";

export default function GenerateLicenseKeysTable({
    licenseKeys,
    orgId
}: GnerateLicenseKeysTableProps) {
    const t = useTranslations();
    const router = useRouter();
    const searchParams = useSearchParams();

    const { env } = useEnvContext();
    const api = createApiClient({ env });

    const [isRefreshing, setIsRefreshing] = useState(false);
    const [showGenerateForm, setShowGenerateForm] = useState(false);
    const [isClearingInstanceName, setIsClearingInstanceName] = useState(false);

    useEffect(() => {
        if (searchParams.get(GENERATE_QUERY) !== null) {
            setShowGenerateForm(true);
            const next = new URLSearchParams(searchParams);
            next.delete(GENERATE_QUERY);
            const qs = next.toString();
            const url = qs
                ? `${window.location.pathname}?${qs}`
                : window.location.pathname;
            window.history.replaceState(null, "", url);
        }
    }, [searchParams]);

    const handleLicenseGenerated = () => {
        // Refresh the data after license is generated
        refreshData();
    };

    const clearInstanceName = async (licenseKey: string) => {
        setIsClearingInstanceName(true);
        try {
            await api.post(
                `/org/${orgId}/license/${encodeURIComponent(licenseKey)}/clear-instance-name`
            );
            toast({
                title: t("success"),
                description: "Server ID cleared successfully"
            });
            await refreshData();
        } catch (error) {
            toast({
                title: t("error"),
                description: formatAxiosError(
                    error,
                    "Failed to clear server ID"
                ),
                variant: "destructive"
            });
        } finally {
            setIsClearingInstanceName(false);
        }
    };

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

    const columns: ExtendedColumnDef<GeneratedLicenseKey>[] = [
        {
            accessorKey: "licenseKey",
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
            accessorKey: "instanceName",
            friendlyName: t("instanceName"),
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("instanceName")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => {
                return row.original.instanceName || "-";
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
                return row.original.isValid ? (
                    <Badge variant="green">{t("yes")}</Badge>
                ) : (
                    <Badge variant="red">{t("no")}</Badge>
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
                const tier = row.original.tier;
                return tier === "enterprise"
                    ? t("licenseTierEnterprise")
                    : t("licenseTierPersonal");
            }
        },
        {
            accessorKey: "users",
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
                const users = row.original.users;
                return users === -1 ? "∞" : users;
            }
        },
        {
            accessorKey: "sites",
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
                const sites = row.original.sites;
                return sites === -1 ? "∞" : sites;
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
                const termianteAt = row.original.expiresAt;
                return moment(termianteAt).format("lll");
            }
        },
        {
            id: "actions",
            enableHiding: false,
            header: () => <span className="p-3"></span>,
            cell: ({ row }) => {
                const key = row.original;
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
                                <DropdownMenuItem
                                    disabled={
                                        !key.instanceName ||
                                        isClearingInstanceName
                                    }
                                    onClick={() =>
                                        clearInstanceName(key.licenseKey)
                                    }
                                >
                                    {t("clearInstanceName")}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                );
            }
        }
    ];

    return (
        <>
            <DataTable
                columns={columns}
                data={licenseKeys}
                persistPageSize="licenseKeys-table"
                title={t("licenseKeys")}
                searchPlaceholder={t("licenseKeySearch")}
                searchColumn="licenseKey"
                onRefresh={refreshData}
                isRefreshing={isRefreshing}
                addButtonText={t("generateLicenseKey")}
                onAdd={() => {
                    setShowGenerateForm(true);
                }}
                stickyRightColumn="actions"
            />

            <NewPricingLicenseForm
                open={showGenerateForm}
                setOpen={setShowGenerateForm}
                orgId={orgId}
                onGenerated={handleLicenseGenerated}
            />
        </>
    );
}
