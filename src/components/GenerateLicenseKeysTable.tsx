"use client";

import {
    Timestamp,
    TimestampInText,
    TIMESTAMP_PLACEHOLDER
} from "@app/components/Timestamp";
import { useTranslations } from "next-intl";
import { ColumnDef } from "@tanstack/react-table";
import { ExtendedColumnDef } from "@app/components/ui/data-table";
import { Button } from "./ui/button";
import { ArrowUpDown, MessageCircle, MoreHorizontal } from "lucide-react";
import CopyToClipboard from "./CopyToClipboard";
import { Badge } from "./ui/badge";
import { DataTable } from "./ui/data-table";
import {
    GeneratedLicenseKey,
    LicenseSupport
} from "@server/routers/generatedLicense/types";
import { useState, useEffect, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import NewLicenseKeyCredenza from "./NewLicenseKeyCredenza";
import GeneratePersonalLicenseForm from "./GeneratePersonalLicenseForm";
import EditLicenseKeyCredenza from "./EditLicenseKeyCredenza";
import LicenseSupportCredenza from "./LicenseSupportCredenza";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "@app/components/ui/tooltip";
import {
    Credenza,
    CredenzaBody,
    CredenzaClose,
    CredenzaContent,
    CredenzaDescription,
    CredenzaFooter,
    CredenzaHeader,
    CredenzaTitle
} from "@app/components/Credenza";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
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
    const [showNewKey, setShowNewKey] = useState(false);
    const [showPersonalForm, setShowPersonalForm] = useState(false);
    const [isClearingInstanceName, setIsClearingInstanceName] = useState(false);
    const [editingKey, setEditingKey] = useState<GeneratedLicenseKey | null>(
        null
    );
    const [cancelingKey, setCancelingKey] =
        useState<GeneratedLicenseKey | null>(null);
    const [isCanceling, setIsCanceling] = useState(false);
    const [isOpeningPortal, setIsOpeningPortal] = useState(false);
    const [showSupport, setShowSupport] = useState(false);

    useEffect(() => {
        if (searchParams.get(GENERATE_QUERY) !== null) {
            setShowNewKey(true);
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

    const setRenewal = async (key: GeneratedLicenseKey, cancel: boolean) => {
        setIsCanceling(true);
        try {
            await api.post(
                `/org/${orgId}/license/${encodeURIComponent(key.licenseKey)}/cancel`,
                { cancel }
            );
            toast({
                title: t("success"),
                description: cancel
                    ? t("licenseCancelSuccess")
                    : t("licenseResumeSuccess")
            });
            setCancelingKey(null);
            await refreshData();
        } catch (error) {
            toast({
                title: t("error"),
                description: formatAxiosError(error),
                variant: "destructive"
            });
        } finally {
            setIsCanceling(false);
        }
    };

    // Payment methods, invoices and billing details live in the Stripe portal
    const openBillingPortal = async (key: GeneratedLicenseKey) => {
        setIsOpeningPortal(true);
        try {
            const res = await api.post<{ data: string }>(
                `/org/${orgId}/license/${encodeURIComponent(key.licenseKey)}/portal-session`
            );
            window.location.href = res.data.data;
        } catch (error) {
            toast({
                title: t("billingPortalError"),
                description: formatAxiosError(error),
                variant: "destructive"
            });
            setIsOpeningPortal(false);
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

    // A value, plus what it changes to at renewal when a change is pending
    const pendingCell = (
        shown: ReactNode,
        atRenewal: string | number | undefined
    ) => {
        if (atRenewal === undefined) {
            return shown;
        }
        return (
            <span className="flex flex-col">
                <span>{shown}</span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {t("licenseRenewsWithValue", { value: atRenewal })}
                </span>
            </span>
        );
    };

    const countCell = (count: number, atRenewal: number | undefined) =>
        pendingCell(
            count === -1 ? "∞" : count,
            atRenewal === undefined || atRenewal === count
                ? undefined
                : atRenewal
        );

    const supportLabel = (support: LicenseSupport) => {
        switch (support) {
            case "email":
                return t("licenseSupportEmail");
            case "priority":
                return t("licenseSupportPriority");
            default:
                return t("licenseSupportCommunity");
        }
    };

    // Only licenses with email or priority support can message support
    const canMessageSupport = licenseKeys.some(
        (key) => key.support !== "community"
    );

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
                switch (tier) {
                    case "enterprise":
                        return t("licenseTierEnterprise");
                    case "personal":
                    case undefined:
                        return t("licenseTierPersonal");
                    default:
                        return t("licenseTierBusiness");
                }
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
            cell: ({ row }) =>
                countCell(
                    row.original.users,
                    row.original.subscription?.renewsWith?.users
                )
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
            cell: ({ row }) =>
                countCell(
                    row.original.sites,
                    row.original.subscription?.renewsWith?.sites
                )
        },
        {
            accessorKey: "machines",
            friendlyName: t("machineClients"),
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("machineClients")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) =>
                countCell(
                    row.original.machines,
                    row.original.subscription?.renewsWith?.machineClients
                )
        },
        {
            id: "addons",
            friendlyName: t("licenseAddons"),
            header: () => <span className="p-3">{t("licenseAddons")}</span>,
            cell: ({ row }) => {
                const { highAvailability, subscription } = row.original;
                const atRenewal = subscription?.renewsWith?.highAvailability;
                return pendingCell(
                    highAvailability ? t("licenseHighAvailability") : "-",
                    atRenewal === undefined || atRenewal === highAvailability
                        ? undefined
                        : atRenewal
                          ? t("licenseHighAvailability")
                          : t("licenseAddonsNone")
                );
            }
        },
        {
            id: "support",
            friendlyName: t("licenseSupport"),
            header: () => <span className="p-3">{t("licenseSupport")}</span>,
            cell: ({ row }) => {
                const { support, subscription } = row.original;
                const atRenewal = subscription?.renewsWith?.support;
                return pendingCell(
                    supportLabel(support),
                    atRenewal === undefined || atRenewal === support
                        ? undefined
                        : supportLabel(atRenewal)
                );
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
                return <Timestamp value={termianteAt} display="duration" />;
            }
        },
        {
            id: "subscription",
            friendlyName: t("licenseTableSubscription"),
            header: () => (
                <span className="p-3">{t("licenseTableSubscription")}</span>
            ),
            cell: ({ row }) => {
                const sub = row.original.subscription;
                if (!sub) {
                    return "-";
                }
                if (sub.status === "past_due" || sub.status === "unpaid") {
                    return (
                        <Badge variant="red">
                            {t("licenseSubscriptionPastDue")}
                        </Badge>
                    );
                }
                if (sub.status === "canceled") {
                    return (
                        <Badge variant="secondary">
                            {t("licenseSubscriptionEnded")}
                        </Badge>
                    );
                }
                // "Renews in 3 years" / "Ends in 2 months", with only the
                // word colored
                return (
                    <span className="whitespace-nowrap">
                        <TimestampInText
                            text={t(
                                sub.cancelAtPeriodEnd
                                    ? "licenseSubscriptionEndsIn"
                                    : "licenseSubscriptionRenewsIn",
                                { date: TIMESTAMP_PLACEHOLDER }
                            )}
                            textClassName={
                                sub.cancelAtPeriodEnd
                                    ? "text-yellow-700 dark:text-yellow-300"
                                    : "text-green-700 dark:text-green-300"
                            }
                            value={sub.currentPeriodEnd}
                        />
                    </span>
                );
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
                                {key.subscription?.editable && (
                                    <DropdownMenuItem
                                        onClick={() => setEditingKey(key)}
                                    >
                                        {t("licenseEditAction")}
                                    </DropdownMenuItem>
                                )}
                                {key.subscription && (
                                    <DropdownMenuItem
                                        disabled={isOpeningPortal}
                                        onClick={() => openBillingPortal(key)}
                                    >
                                        {t("licenseManageBillingAction")}
                                    </DropdownMenuItem>
                                )}
                                {key.subscription &&
                                    key.subscription.status !== "canceled" &&
                                    (key.subscription.cancelAtPeriodEnd ? (
                                        <DropdownMenuItem
                                            disabled={isCanceling}
                                            onClick={() =>
                                                setRenewal(key, false)
                                            }
                                        >
                                            {t("licenseResumeAction")}
                                        </DropdownMenuItem>
                                    ) : (
                                        <DropdownMenuItem
                                            onClick={() => setCancelingKey(key)}
                                        >
                                            <span className="text-red-500">
                                                {t("licenseCancelAction")}
                                            </span>
                                        </DropdownMenuItem>
                                    ))}
                                {key.subscription && <DropdownMenuSeparator />}
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
                addButtonText={t("newLicenseKeyTitle")}
                onAdd={() => {
                    setShowNewKey(true);
                }}
                stickyRightColumn="actions"
                extraActions={
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <span>
                                    <Button
                                        variant="outline"
                                        disabled={!canMessageSupport}
                                        onClick={() => setShowSupport(true)}
                                    >
                                        <MessageCircle className="mr-0 sm:mr-2 h-4 w-4" />
                                        <span className="hidden sm:inline">
                                            {t("messageSupport")}
                                        </span>
                                    </Button>
                                </span>
                            </TooltipTrigger>
                            {!canMessageSupport && (
                                <TooltipContent>
                                    <p>{t("licenseSupportRequiresPlan")}</p>
                                </TooltipContent>
                            )}
                        </Tooltip>
                    </TooltipProvider>
                }
            />

            <LicenseSupportCredenza
                open={showSupport}
                setOpen={setShowSupport}
                orgId={orgId}
                licenseKeys={licenseKeys}
            />

            <NewLicenseKeyCredenza
                open={showNewKey}
                setOpen={setShowNewKey}
                orgId={orgId}
                onChoosePersonal={() => setShowPersonalForm(true)}
            />

            <GeneratePersonalLicenseForm
                open={showPersonalForm}
                setOpen={setShowPersonalForm}
                orgId={orgId}
                onGenerated={handleLicenseGenerated}
            />

            <EditLicenseKeyCredenza
                open={editingKey !== null}
                setOpen={(open) => {
                    if (!open) setEditingKey(null);
                }}
                orgId={orgId}
                licenseKey={editingKey}
                onUpdated={() => refreshData()}
            />

            <Credenza
                open={cancelingKey !== null}
                onOpenChange={(open) => {
                    if (!open) setCancelingKey(null);
                }}
            >
                <CredenzaContent>
                    <CredenzaHeader>
                        <CredenzaTitle>{t("licenseCancelTitle")}</CredenzaTitle>
                        <CredenzaDescription>
                            {t("licenseCancelDescription")}
                        </CredenzaDescription>
                    </CredenzaHeader>
                    <CredenzaBody>
                        {cancelingKey?.subscription && (
                            <p className="text-sm">
                                <TimestampInText
                                    text={t("licenseCancelStopsWorking", {
                                        date: TIMESTAMP_PLACEHOLDER
                                    })}
                                    value={
                                        cancelingKey.subscription
                                            .currentPeriodEnd
                                    }
                                />
                            </p>
                        )}
                    </CredenzaBody>
                    <CredenzaFooter>
                        <CredenzaClose asChild>
                            <Button variant="outline" disabled={isCanceling}>
                                {t("licenseCancelKeep")}
                            </Button>
                        </CredenzaClose>
                        <Button
                            variant="destructive"
                            onClick={() =>
                                cancelingKey && setRenewal(cancelingKey, true)
                            }
                            disabled={isCanceling}
                            loading={isCanceling}
                        >
                            {t("licenseCancelConfirm")}
                        </Button>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>
        </>
    );
}
