"use client";

import { ColumnEntityFilter } from "@app/components/ColumnEntityFilter";
import { ColumnFilterButton } from "@app/components/ColumnFilterButton";
import {
    ResourceSelector,
    type SelectedResource
} from "@app/components/resource-selector";
import { UserSelector, type SelectedUser } from "@app/components/user-selector";
import {
    ControlledDataTable,
    type ExtendedColumnDef
} from "@app/components/ui/controlled-data-table";
import { Button } from "@app/components/ui/button";
import { Badge } from "@app/components/ui/badge";
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
    ArrowDown01Icon,
    ArrowUp10Icon,
    ArrowUpRight,
    ChevronsUpDownIcon,
    XIcon
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { useDebouncedCallback } from "use-debounce";
import type { PaginationState } from "@tanstack/react-table";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { toast } from "@app/hooks/useToast";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useNavigationContext } from "@app/hooks/useNavigationContext";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { getNextSortOrder, getSortDirection } from "@app/lib/sortColumn";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { getUserDisplayName } from "@app/lib/getUserDisplayName";
import {
    resourceSessionAuthMethods,
    type ResourceSessionAuthMethod,
    type ResourceSessionItem
} from "@server/routers/resourceSession/types";
import moment from "moment";
import { useTranslations } from "next-intl";

type ResourceSessionsTableProps = {
    sessions: ResourceSessionItem[];
    orgId: string;
    rowCount: number;
    pagination: PaginationState;
    initialFilterResource?: SelectedResource | null;
    initialFilterUser?: SelectedUser | null;
};

const AUTH_METHOD_TRANSLATION_KEYS: Record<
    ResourceSessionAuthMethod,
    | "resourceSessionsMethodSso"
    | "resourceSessionsMethodPassword"
    | "resourceSessionsMethodPincode"
    | "resourceSessionsMethodWhitelist"
    | "resourceSessionsMethodAccessToken"
> = {
    sso: "resourceSessionsMethodSso",
    password: "resourceSessionsMethodPassword",
    pincode: "resourceSessionsMethodPincode",
    whitelist: "resourceSessionsMethodWhitelist",
    accessToken: "resourceSessionsMethodAccessToken"
};

function getResourceSessionIdentity(session: ResourceSessionItem): string {
    if (session.user) {
        return getUserDisplayName({
            email: session.user.email,
            name: session.user.name,
            username: session.user.username
        });
    }
    return session.email ?? session.accessTokenTitle ?? "";
}

export default function ResourceSessionsTable({
    sessions,
    orgId,
    rowCount,
    pagination,
    initialFilterResource = null,
    initialFilterUser = null
}: ResourceSessionsTableProps) {
    const router = useRouter();
    const t = useTranslations();
    const api = createApiClient(useEnvContext());
    const { isPaidUser } = usePaidStatus();
    const {
        navigate: filter,
        isNavigating: isFiltering,
        searchParams
    } = useNavigationContext();

    const [selectedSession, setSelectedSession] =
        useState<ResourceSessionItem | null>(null);
    const [isRevoking, setIsRevoking] = useState(false);
    const [isRefreshing, startTransition] = useTransition();
    const [resourceFilterOpen, setResourceFilterOpen] = useState(false);
    const [userFilterOpen, setUserFilterOpen] = useState(false);

    const canRevoke = isPaidUser(tierMatrix.resourceSessions);

    const resourceIdQ = searchParams.get("resourceId");
    const resourceIdNum = resourceIdQ ? parseInt(resourceIdQ, 10) : NaN;
    const selectedResource: SelectedResource | null = useMemo(() => {
        if (
            !resourceIdQ ||
            !Number.isInteger(resourceIdNum) ||
            resourceIdNum <= 0
        ) {
            return null;
        }
        if (
            initialFilterResource &&
            initialFilterResource.resourceId === resourceIdNum
        ) {
            return initialFilterResource;
        }
        return {
            name: t("redirectFilterResourceFallback", { id: resourceIdNum }),
            resourceId: resourceIdNum,
            fullDomain: null,
            niceId: "",
            ssl: false,
            wildcard: false
        };
    }, [initialFilterResource, resourceIdQ, resourceIdNum, t]);

    const userIdQ = searchParams.get("userId");
    const selectedUser: SelectedUser | null = useMemo(() => {
        if (!userIdQ) {
            return null;
        }
        if (initialFilterUser && initialFilterUser.id === userIdQ) {
            return initialFilterUser;
        }
        return { id: userIdQ, text: userIdQ };
    }, [initialFilterUser, userIdQ]);

    const sessionIdQ = searchParams.get("sessionId");

    function refreshData() {
        startTransition(() => {
            try {
                router.refresh();
            } catch {
                toast({
                    title: t("error"),
                    description: t("refreshError"),
                    variant: "destructive"
                });
            }
        });
    }

    const handlePaginationChange = (newPage: PaginationState) => {
        searchParams.set("page", (newPage.pageIndex + 1).toString());
        searchParams.set("pageSize", newPage.pageSize.toString());
        filter({ searchParams });
    };

    const handleSearchChange = useDebouncedCallback((query: string) => {
        searchParams.set("query", query);
        searchParams.delete("page");
        filter({ searchParams });
    }, 300);

    function handleFilterChange(column: string, value: string | undefined) {
        searchParams.delete(column);
        searchParams.delete("page");

        if (value) {
            searchParams.set(column, value);
        }

        filter({ searchParams });
    }

    function toggleSort(column: string) {
        filter({ searchParams: getNextSortOrder(column, searchParams) });
    }

    async function revokeSession(sessionId: string) {
        setIsRevoking(true);
        try {
            await api.delete(`/org/${orgId}/resource-session/${sessionId}`);
            setSelectedSession(null);
            toast({
                title: t("resourceSessionsRevoked"),
                description: t("resourceSessionsRevokedDescription")
            });
            // Revoking an SSO session also removes its siblings from the same
            // login, so pull the list again rather than guessing which ones
            router.refresh();
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("resourceSessionsErrorRevoke"),
                description: formatAxiosError(
                    e,
                    t("resourceSessionsErrorRevokeDescription")
                )
            });
        } finally {
            setIsRevoking(false);
        }
    }

    function sortableHeader(column: string, label: string) {
        const direction = getSortDirection(column, searchParams);
        const Icon =
            direction === "asc"
                ? ArrowDown01Icon
                : direction === "desc"
                  ? ArrowUp10Icon
                  : ChevronsUpDownIcon;

        return (
            <Button
                variant="ghost"
                className="p-3"
                onClick={() => toggleSort(column)}
            >
                {label}
                <Icon className="ml-2 h-4 w-4" />
            </Button>
        );
    }

    const columns: ExtendedColumnDef<ResourceSessionItem>[] = [
        {
            id: "user",
            enableHiding: false,
            friendlyName: t("user"),
            header: () => (
                <ColumnEntityFilter
                    label={t("user")}
                    open={userFilterOpen}
                    onOpenChange={setUserFilterOpen}
                    selectedName={selectedUser?.text}
                    clearLabel={t("resourceSessionsFilterAnyUser")}
                    onClear={() => {
                        handleFilterChange("userId", undefined);
                        setUserFilterOpen(false);
                    }}
                >
                    <UserSelector
                        orgId={orgId}
                        selectedUser={selectedUser}
                        allowClear={false}
                        onSelectUser={(user) => {
                            handleFilterChange("userId", user?.id);
                            setUserFilterOpen(false);
                        }}
                    />
                </ColumnEntityFilter>
            ),
            cell: ({ row }) => {
                const r = row.original;
                const identity = getResourceSessionIdentity(r);
                if (r.user) {
                    return (
                        <Link
                            href={`/${orgId}/settings/access/users/${r.user.userId}`}
                        >
                            <Button variant="outline" size="sm">
                                {identity}
                                <ArrowUpRight className="ml-2 h-3 w-3" />
                            </Button>
                        </Link>
                    );
                }
                if (identity) {
                    return <span>{identity}</span>;
                }
                return (
                    <span className="text-muted-foreground">
                        {t("resourceSessionsAnonymous")}
                    </span>
                );
            }
        },
        {
            id: "resource",
            friendlyName: t("resource"),
            header: () => (
                <ColumnEntityFilter
                    label={t("resource")}
                    open={resourceFilterOpen}
                    onOpenChange={setResourceFilterOpen}
                    selectedName={selectedResource?.name}
                    clearLabel={t("redirectFilterAnyResource")}
                    onClear={() => {
                        handleFilterChange("resourceId", undefined);
                        setResourceFilterOpen(false);
                    }}
                >
                    <ResourceSelector
                        orgId={orgId}
                        selectedResource={selectedResource}
                        onSelectResource={(resource) => {
                            handleFilterChange(
                                "resourceId",
                                String(resource.resourceId)
                            );
                            setResourceFilterOpen(false);
                        }}
                    />
                </ColumnEntityFilter>
            ),
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
            id: "authMethod",
            friendlyName: t("resourceSessionsMethod"),
            header: () => (
                <ColumnFilterButton
                    options={resourceSessionAuthMethods.map((method) => ({
                        value: method,
                        label: t(AUTH_METHOD_TRANSLATION_KEYS[method])
                    }))}
                    selectedValue={searchParams.get("authMethod") ?? undefined}
                    onValueChange={(value) =>
                        handleFilterChange("authMethod", value)
                    }
                    searchPlaceholder={t("searchPlaceholder")}
                    emptyMessage={t("emptySearchOptions")}
                    label={t("resourceSessionsMethod")}
                    className="p-3"
                />
            ),
            cell: ({ row }) => {
                const method = row.original.authMethod;
                if (!method) {
                    return <span>-</span>;
                }
                return (
                    <Badge variant="secondary">
                        {t(AUTH_METHOD_TRANSLATION_KEYS[method])}
                    </Badge>
                );
            }
        },
        {
            id: "issuedAt",
            friendlyName: t("resourceSessionsIssued"),
            header: () =>
                sortableHeader("issuedAt", t("resourceSessionsIssued")),
            cell: ({ row }) => {
                const issuedAt = row.original.issuedAt;
                return issuedAt ? moment(issuedAt).format("lll") : "-";
            }
        },
        {
            id: "expiresAt",
            friendlyName: t("expires"),
            header: () => sortableHeader("expiresAt", t("expires")),
            cell: ({ row }) => moment(row.original.expiresAt).format("lll")
        },
        {
            id: "revoke",
            enableHiding: false,
            header: () => <span className="p-3"></span>,
            cell: ({ row }) => (
                <div className="flex items-center justify-end">
                    <Button
                        variant="outline"
                        disabled={!canRevoke}
                        onClick={() => setSelectedSession(row.original)}
                    >
                        {t("resourceSessionsRevoke")}
                    </Button>
                </div>
            )
        }
    ];

    return (
        <>
            <Credenza
                open={selectedSession !== null}
                onOpenChange={(open) => {
                    if (!open) setSelectedSession(null);
                }}
            >
                <CredenzaContent>
                    <CredenzaHeader>
                        <CredenzaTitle>
                            {t("resourceSessionsRevokeTitle")}
                        </CredenzaTitle>
                        <CredenzaDescription>
                            {t("resourceSessionsRevokeQuestion", {
                                identity:
                                    (selectedSession &&
                                        getResourceSessionIdentity(
                                            selectedSession
                                        )) ||
                                    t("resourceSessionsAnonymous"),
                                resource: selectedSession?.resourceName ?? ""
                            })}
                        </CredenzaDescription>
                    </CredenzaHeader>
                    {selectedSession?.authMethod === "sso" && (
                        <CredenzaBody>
                            <p className="text-sm text-muted-foreground">
                                {t("resourceSessionsRevokeSsoNote")}
                            </p>
                        </CredenzaBody>
                    )}
                    <CredenzaFooter>
                        <CredenzaClose asChild>
                            <Button variant="outline">{t("cancel")}</Button>
                        </CredenzaClose>
                        <Button
                            variant="destructive"
                            loading={isRevoking}
                            onClick={() =>
                                selectedSession &&
                                revokeSession(selectedSession.sessionId)
                            }
                        >
                            {t("resourceSessionsRevoke")}
                        </Button>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>

            <ControlledDataTable
                columns={columns}
                rows={sessions}
                tableId="resource-sessions-table"
                searchPlaceholder={t("resourceSessionsSearch")}
                pagination={pagination}
                onPaginationChange={handlePaginationChange}
                searchQuery={searchParams.get("query")?.toString()}
                onSearch={handleSearchChange}
                onRefresh={refreshData}
                isRefreshing={isRefreshing || isFiltering}
                rowCount={rowCount}
                filterExtras={
                    // Set when following a link from the request/access logs
                    sessionIdQ ? (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                                handleFilterChange("sessionId", undefined)
                            }
                        >
                            {t("resourceSessionsFilteredToSession")}
                            <XIcon className="ml-2 h-3 w-3" />
                        </Button>
                    ) : undefined
                }
                enableColumnVisibility
                stickyLeftColumn="user"
                stickyRightColumn="revoke"
            />
        </>
    );
}
