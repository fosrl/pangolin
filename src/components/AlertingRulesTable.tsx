"use client";

import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { Button } from "@app/components/ui/button";
import { DataTable, ExtendedColumnDef } from "@app/components/ui/data-table";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@app/components/ui/dropdown-menu";
import { Switch } from "@app/components/ui/switch";
import { toast } from "@app/hooks/useToast";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useNavigationContext } from "@app/hooks/useNavigationContext";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { getNextSortOrder, getSortDirection } from "@app/lib/sortColumn";
import {
    alertRuleMatchesAllSources,
    alertRuleSourceType
} from "@app/lib/alertRuleForm";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import {
    ArrowDown01Icon,
    ArrowUp10Icon,
    ChevronsUpDownIcon,
    MoreHorizontal
} from "lucide-react";
import moment from "moment";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import z from "zod";
import { ColumnFilterButton } from "./ColumnFilterButton";
import type { PaginationState } from "@tanstack/react-table";
import type { DataTablePaginationState } from "@app/components/ui/data-table";
import { useDebouncedCallback } from "use-debounce";

const alertRulesEnabledQuerySchema = z
    .enum(["true", "false"])
    .optional()
    .catch(undefined);

export type AlertRuleRow = {
    alertRuleId: number;
    orgId: string;
    name: string;
    eventType: string;
    enabled: boolean;
    cooldownSeconds: number;
    lastTriggeredAt: number | null;
    createdAt: number;
    updatedAt: number;
    allSites: boolean;
    allHealthChecks: boolean;
    allResources: boolean;
    siteIds: number[];
    healthCheckIds: number[];
    resourceIds: number[];
    labelIds: number[];
};

type AlertingRulesTableProps = {
    orgId: string;
    alertRules: AlertRuleRow[];
    rowCount: number;
};

function ruleHref(orgId: string, ruleId: number) {
    return `/${orgId}/settings/alerting/${ruleId}`;
}

function sourceSummary(
    rule: AlertRuleRow,
    t: (k: string, o?: Record<string, number | string>) => string
) {
    const kind = alertRuleSourceType(rule.eventType);
    const { allKey, countKey, ids } =
        kind === "site"
            ? {
                  allKey: "alertingSummaryAllSites",
                  countKey: "alertingSummarySites",
                  ids: rule.siteIds
              }
            : kind === "resource"
              ? {
                    allKey: "alertingSummaryAllResources",
                    countKey: "alertingSummaryResources",
                    ids: rule.resourceIds
                }
              : {
                    allKey: "alertingSummaryAllHealthChecks",
                    countKey: "alertingSummaryHealthChecks",
                    ids: rule.healthCheckIds
                };

    if (alertRuleMatchesAllSources(rule)) {
        return t(allKey);
    }

    const parts: string[] = [];
    if (ids.length > 0 || rule.labelIds.length === 0) {
        parts.push(t(countKey, { count: ids.length }));
    }
    if (rule.labelIds.length > 0) {
        parts.push(t("alertingSummaryLabels", { count: rule.labelIds.length }));
    }
    return parts.join(", ");
}

function triggerLabel(rule: AlertRuleRow, t: (k: string) => string) {
    switch (rule.eventType) {
        case "site_online":
            return t("alertingTriggerSiteOnline");
        case "site_offline":
            return t("alertingTriggerSiteOffline");
        case "site_toggle":
            return t("alertingTriggerSiteToggle");
        case "health_check_healthy":
            return t("alertingTriggerHcHealthy");
        case "health_check_unhealthy":
            return t("alertingTriggerHcUnhealthy");
        case "health_check_toggle":
            return t("alertingTriggerHcToggle");
        case "resource_healthy":
            return t("alertingTriggerResourceHealthy");
        case "resource_unhealthy":
            return t("alertingTriggerResourceUnhealthy");
        case "resource_degraded":
            return t("alertingTriggerResourceDegraded");
        case "resource_toggle":
            return t("alertingTriggerResourceToggle");
        default:
            return rule.eventType;
    }
}

export default function AlertingRulesTable({
    orgId,
    alertRules,
    rowCount
}: AlertingRulesTableProps) {
    const router = useRouter();
    const t = useTranslations();
    const envContext = useEnvContext();
    const api = createApiClient(envContext);
    const { env } = envContext;
    const [isRefreshing, startRefresh] = useTransition();
    const { isPaidUser } = usePaidStatus();
    const isPaid = isPaidUser(tierMatrix.alertingRules);

    const {
        navigate: filter,
        isNavigating: isFiltering,
        searchParams
    } = useNavigationContext();

    const [deleteOpen, setDeleteOpen] = useState(false);
    const [selected, setSelected] = useState<AlertRuleRow | null>(null);
    const [togglingId, setTogglingId] = useState<number | null>(null);

    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.max(1, Number(searchParams.get("pageSize") ?? 20));
    const pageIndex = page - 1;
    const query = searchParams.get("query") ?? undefined;
    const sortBy = searchParams.get("sort_by") ?? undefined;
    const order = searchParams.get("order") ?? undefined;
    const enabledForQuery = alertRulesEnabledQuerySchema.parse(
        searchParams.get("enabled") ?? undefined
    );

    const enabledFilterOptions = useMemo(
        () => [
            { value: "true", label: t("enabled") },
            { value: "false", label: t("disabled") }
        ],
        [t]
    );

    const rows = alertRules;
    const total = rowCount;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));

    function refreshList() {
        startRefresh(() => {
            router.refresh();
        });
    }

    const paginationState: DataTablePaginationState = {
        pageIndex,
        pageSize,
        pageCount
    };

    const handlePaginationChange = (newState: PaginationState) => {
        searchParams.set("page", (newState.pageIndex + 1).toString());
        searchParams.set("pageSize", newState.pageSize.toString());
        filter({ searchParams });
    };

    const handleSearchChange = useDebouncedCallback((value: string) => {
        if (value) {
            searchParams.set("query", value);
        } else {
            searchParams.delete("query");
        }
        searchParams.delete("page");
        filter({ searchParams });
    }, 300);

    function toggleSort(column: string) {
        filter({
            searchParams: getNextSortOrder(column, searchParams)
        });
    }

    function handleEnabledFilter(value: string | undefined | null) {
        const sp = new URLSearchParams(searchParams);
        sp.delete("enabled");
        sp.delete("page");
        if (value) {
            sp.set("enabled", value);
        }
        filter({ searchParams: sp });
    }

    const setEnabled = async (rule: AlertRuleRow, enabled: boolean) => {
        setTogglingId(rule.alertRuleId);
        try {
            await api.post(`/org/${orgId}/alert-rule/${rule.alertRuleId}`, {
                enabled
            });
            refreshList();
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        } finally {
            setTogglingId(null);
        }
    };

    const confirmDelete = async () => {
        if (!selected) return;
        try {
            await api.delete(
                `/org/${orgId}/alert-rule/${selected.alertRuleId}`
            );
            refreshList();
            toast({ title: t("alertingRuleDeleted") });
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        } finally {
            setDeleteOpen(false);
            setSelected(null);
        }
    };

    const columns: ExtendedColumnDef<AlertRuleRow>[] = [
        {
            accessorKey: "name",
            enableHiding: false,
            friendlyName: t("name"),
            header: () => {
                const nameOrder = getSortDirection("name", searchParams);
                const Icon =
                    nameOrder === "asc"
                        ? ArrowDown01Icon
                        : nameOrder === "desc"
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
            },
            cell: ({ row }) => <span>{row.original.name}</span>
        },
        {
            id: "source",
            friendlyName: t("alertingColumnSource"),
            header: () => (
                <span className="p-3">{t("alertingColumnSource")}</span>
            ),
            cell: ({ row }) => <span>{sourceSummary(row.original, t)}</span>
        },
        {
            id: "trigger",
            friendlyName: t("alertingColumnTrigger"),
            header: () => (
                <span className="p-3">{t("alertingColumnTrigger")}</span>
            ),
            cell: ({ row }) => <span>{triggerLabel(row.original, t)}</span>
        },
        {
            accessorKey: "lastTriggeredAt",
            friendlyName: t("lastTriggeredAt"),
            header: () => {
                const triggerOrder = getSortDirection(
                    "last_triggered_at",
                    searchParams
                );
                const Icon =
                    triggerOrder === "asc"
                        ? ArrowDown01Icon
                        : triggerOrder === "desc"
                          ? ArrowUp10Icon
                          : ChevronsUpDownIcon;
                return (
                    <Button
                        variant="ghost"
                        className="p-3"
                        onClick={() => toggleSort("last_triggered_at")}
                    >
                        {t("lastTriggeredAt")}
                        <Icon className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => (
                <span>
                    {row.original.lastTriggeredAt
                        ? moment(row.original.lastTriggeredAt).format("lll")
                        : "-"}
                </span>
            )
        },
        {
            accessorKey: "enabled",
            friendlyName: t("alertingColumnEnabled"),
            header: () => (
                <ColumnFilterButton
                    options={enabledFilterOptions}
                    selectedValue={enabledForQuery}
                    onValueChange={handleEnabledFilter}
                    searchPlaceholder={t("searchPlaceholder")}
                    emptyMessage={t("emptySearchOptions")}
                    label={t("alertingColumnEnabled")}
                    className="p-3"
                />
            ),
            cell: ({ row }) => {
                const r = row.original;
                return (
                    <Switch
                        checked={r.enabled}
                        disabled={!isPaid || togglingId === r.alertRuleId}
                        onCheckedChange={(v) => setEnabled(r, v)}
                    />
                );
            }
        },
        {
            id: "rowActions",
            enableHiding: false,
            header: () => <span className="p-3" />,
            cell: ({ row }) => {
                const r = row.original;
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
                                    disabled={!isPaid}
                                    onClick={() => {
                                        setSelected(r);
                                        setDeleteOpen(true);
                                    }}
                                >
                                    <span className="text-red-500">
                                        {t("delete")}
                                    </span>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Button variant="outline" asChild>
                            <Link href={ruleHref(orgId, r.alertRuleId)}>
                                {t("edit")}
                            </Link>
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
                    open={deleteOpen}
                    setOpen={(val) => {
                        setDeleteOpen(val);
                        if (!val) setSelected(null);
                    }}
                    dialog={
                        <div className="space-y-2">
                            <p>{t("alertingDeleteQuestion")}</p>
                        </div>
                    }
                    buttonText={t("delete")}
                    onConfirm={confirmDelete}
                    string={selected.name}
                    title={t("alertingDeleteRule")}
                />
            )}
            <PaidFeaturesAlert tiers={tierMatrix.alertingRules} />

            <DataTable
                columns={columns}
                data={rows}
                title={t("alertingRules")}
                searchPlaceholder={t("alertingSearchRules")}
                onSearch={handleSearchChange}
                searchQuery={query}
                manualFiltering
                manualSorting
                onAdd={
                    !env.flags.disableEnterpriseFeatures
                        ? () => {
                              router.push(`/${orgId}/settings/alerting/create`);
                          }
                        : undefined
                }
                onRefresh={refreshList}
                isRefreshing={isRefreshing || isFiltering}
                addButtonText={t("alertingAddRule")}
                enableColumnVisibility
                stickyLeftColumn="name"
                stickyRightColumn="rowActions"
                pagination={paginationState}
                onPaginationChange={handlePaginationChange}
            />
        </>
    );
}
