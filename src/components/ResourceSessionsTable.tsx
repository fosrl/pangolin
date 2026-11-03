"use client";

import { Timestamp } from "@app/components/Timestamp";
import { ColumnEntityFilter } from "@app/components/ColumnEntityFilter";
import { ColumnFilterButton } from "@app/components/ColumnFilterButton";
import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import IdpTypeBadge from "@app/components/IdpTypeBadge";
import {
    ResourceSelector,
    type SelectedResource
} from "@app/components/resource-selector";
import {
    ShareLinkSelector,
    type SelectedShareLink
} from "@app/components/share-link-selector";
import { UserSelector, type SelectedUser } from "@app/components/user-selector";
import {
    ControlledDataTable,
    type ExtendedColumnDef
} from "@app/components/ui/controlled-data-table";
import { Button } from "@app/components/ui/button";
import {
    ArrowDown01Icon,
    ArrowUp10Icon,
    ArrowUpRight,
    ChevronsUpDownIcon,
    XIcon
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type ReactNode } from "react";
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
import { countryCodeToFlagEmoji } from "@app/lib/countryCodeToFlagEmoji";
import { parseUserAgent } from "@app/lib/parseUserAgent";
import { useTranslations } from "next-intl";

type ResourceSessionsTableProps = {
    sessions: ResourceSessionItem[];
    orgId: string;
    rowCount: number;
    pagination: PaginationState;
    initialFilterResource?: SelectedResource | null;
    initialFilterUser?: SelectedUser | null;
    initialFilterShareLink?: SelectedShareLink | null;
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

const DEVICE_TRANSLATION_KEYS = {
    desktop: "resourceSessionsDetailDeviceDesktop",
    mobile: "resourceSessionsDetailDeviceMobile",
    tablet: "resourceSessionsDetailDeviceTablet",
    bot: "resourceSessionsDetailDeviceBot"
} as const;

function DetailItem({
    label,
    children
}: {
    label: string;
    children: ReactNode;
}) {
    return (
        <div className="min-w-0">
            <div className="font-medium">{label}</div>
            <div className="mt-1 text-muted-foreground break-all">
                {children}
            </div>
        </div>
    );
}

function getResourceSessionIdentity(session: ResourceSessionItem): string {
    if (session.accessTokenId) {
        return session.accessTokenTitle ?? session.accessTokenId;
    }
    if (session.user) {
        return getUserDisplayName({
            email: session.user.email,
            name: session.user.name,
            username: session.user.username
        });
    }
    return session.email ?? "";
}

export default function ResourceSessionsTable({
    sessions,
    orgId,
    rowCount,
    pagination,
    initialFilterResource = null,
    initialFilterUser = null,
    initialFilterShareLink = null
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
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isRefreshing, startTransition] = useTransition();
    const [resourceFilterOpen, setResourceFilterOpen] = useState(false);
    const [actorFilterOpen, setActorFilterOpen] = useState(false);

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

    const accessTokenIdQ = searchParams.get("accessTokenId");
    const selectedShareLink: SelectedShareLink | null = useMemo(() => {
        if (!accessTokenIdQ) {
            return null;
        }
        if (
            initialFilterShareLink &&
            initialFilterShareLink.accessTokenId === accessTokenIdQ
        ) {
            return initialFilterShareLink;
        }
        return {
            accessTokenId: accessTokenIdQ,
            title: accessTokenIdQ
        };
    }, [initialFilterShareLink, accessTokenIdQ]);

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

    function clearActorFilters() {
        searchParams.delete("userId");
        searchParams.delete("accessTokenId");
        searchParams.delete("page");
        filter({ searchParams });
    }

    function selectActorUser(user: SelectedUser | null) {
        searchParams.delete("accessTokenId");
        searchParams.delete("page");
        if (user?.id) {
            searchParams.set("userId", user.id);
        } else {
            searchParams.delete("userId");
        }
        filter({ searchParams });
        setActorFilterOpen(false);
    }

    function selectActorShareLink(shareLink: SelectedShareLink | null) {
        searchParams.delete("userId");
        searchParams.delete("page");
        if (shareLink?.accessTokenId) {
            searchParams.set("accessTokenId", shareLink.accessTokenId);
        } else {
            searchParams.delete("accessTokenId");
        }
        filter({ searchParams });
        setActorFilterOpen(false);
    }

    function toggleSort(column: string) {
        filter({ searchParams: getNextSortOrder(column, searchParams) });
    }

    async function revokeSession(sessionId: string) {
        try {
            await api.delete(`/org/${orgId}/resource-session/${sessionId}`);
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
            throw e;
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

    function renderExpandedRow(session: ResourceSessionItem) {
        const hasClientInfo = Boolean(session.ip || session.userAgent);
        const parsedUserAgent = parseUserAgent(session.userAgent);
        const notRecorded = (
            <span>{t("resourceSessionsDetailNotRecorded")}</span>
        );

        return (
            <div className="space-y-4 text-xs whitespace-normal">
                {!hasClientInfo && (
                    <p className="text-muted-foreground">
                        {t("resourceSessionsDetailNotRecordedDescription")}
                    </p>
                )}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <DetailItem label={t("resourceSessionsDetailIp")}>
                        {session.ip ? (
                            <span className="font-mono">{session.ip}</span>
                        ) : (
                            notRecorded
                        )}
                    </DetailItem>
                    <DetailItem label={t("location")}>
                        {session.countryCode
                            ? `${countryCodeToFlagEmoji(session.countryCode)} ${session.countryCode}`
                            : session.ip
                              ? t("unknown")
                              : notRecorded}
                    </DetailItem>
                    <DetailItem label={t("resourceSessionsDetailNetwork")}>
                        {session.asn
                            ? `AS${session.asn}`
                            : session.ip
                              ? t("unknown")
                              : notRecorded}
                    </DetailItem>
                    <DetailItem label={t("resourceSessionsDetailSessionId")}>
                        <span className="font-mono">{session.sessionId}</span>
                    </DetailItem>
                    <DetailItem label={t("resourceSessionsDetailBrowser")}>
                        {parsedUserAgent.browser ??
                            (session.userAgent ? t("unknown") : notRecorded)}
                    </DetailItem>
                    <DetailItem label={t("operatingSystem")}>
                        {parsedUserAgent.os ??
                            (session.userAgent ? t("unknown") : notRecorded)}
                    </DetailItem>
                    <DetailItem label={t("resourceSessionsDetailDevice")}>
                        {parsedUserAgent.device
                            ? t(DEVICE_TRANSLATION_KEYS[parsedUserAgent.device])
                            : notRecorded}
                    </DetailItem>
                </div>
                {session.userAgent && (
                    <DetailItem label={t("resourceSessionsDetailUserAgent")}>
                        <span className="font-mono">{session.userAgent}</span>
                    </DetailItem>
                )}
            </div>
        );
    }

    const columns: ExtendedColumnDef<ResourceSessionItem>[] = [
        {
            id: "actor",
            enableHiding: false,
            friendlyName: t("actor"),
            header: () => (
                <ColumnEntityFilter
                    label={t("actor")}
                    open={actorFilterOpen}
                    onOpenChange={setActorFilterOpen}
                    selectedName={
                        selectedUser?.text ?? selectedShareLink?.title
                    }
                    clearLabel={t("resourceSessionsFilterAnyActor")}
                    onClear={() => {
                        clearActorFilters();
                        setActorFilterOpen(false);
                    }}
                >
                    <div className="border-b px-2 py-1.5 text-xs font-medium text-muted-foreground">
                        {t("users")}
                    </div>
                    <UserSelector
                        orgId={orgId}
                        selectedUser={selectedUser}
                        allowClear={false}
                        onSelectUser={selectActorUser}
                    />
                    <div className="border-y px-2 py-1.5 text-xs font-medium text-muted-foreground">
                        {t("shareLinks")}
                    </div>
                    <ShareLinkSelector
                        orgId={orgId}
                        selectedShareLink={selectedShareLink}
                        allowClear={false}
                        onSelectShareLink={selectActorShareLink}
                    />
                </ColumnEntityFilter>
            ),
            cell: ({ row }) => {
                const r = row.original;

                if (r.accessTokenId) {
                    return (
                        <Link href={`/${orgId}/settings/share-links`}>
                            <Button variant="outline" size="sm">
                                {r.accessTokenTitle ||
                                    t("resourceSessionsMethodAccessToken")}
                                <ArrowUpRight className="ml-2 h-3 w-3" />
                            </Button>
                        </Link>
                    );
                }

                if (r.user) {
                    return (
                        <div className="flex items-center gap-2">
                            <Link
                                href={`/${orgId}/settings/access/users/${r.user.userId}`}
                            >
                                <Button variant="outline" size="sm">
                                    {getUserDisplayName({
                                        email: r.user.email,
                                        name: r.user.name,
                                        username: r.user.username
                                    })}
                                    <ArrowUpRight className="ml-2 h-3 w-3" />
                                </Button>
                            </Link>
                            {(r.user.type ?? "internal") !== "internal" && (
                                <IdpTypeBadge
                                    type={r.user.type}
                                    name={
                                        r.user.idpName?.trim()
                                            ? r.user.idpName
                                            : t("idpNameInternal")
                                    }
                                    variant={r.user.idpVariant ?? undefined}
                                />
                            )}
                        </div>
                    );
                }

                if (r.email) {
                    return <span>{r.email}</span>;
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
                return <span>{t(AUTH_METHOD_TRANSLATION_KEYS[method])}</span>;
            }
        },
        {
            id: "issuedAt",
            friendlyName: t("resourceSessionsIssued"),
            header: () =>
                sortableHeader("issuedAt", t("resourceSessionsIssued")),
            cell: ({ row }) => <Timestamp value={row.original.issuedAt} />
        },
        {
            id: "expiresAt",
            friendlyName: t("expires"),
            header: () => sortableHeader("expiresAt", t("expires")),
            cell: ({ row }) => <Timestamp value={row.original.expiresAt} />
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
                        onClick={() => {
                            setSelectedSession(row.original);
                            setIsDeleteModalOpen(true);
                        }}
                    >
                        {t("resourceSessionsRevoke")}
                    </Button>
                </div>
            )
        }
    ];

    return (
        <>
            {selectedSession && (
                <ConfirmDeleteDialog
                    open={isDeleteModalOpen}
                    setOpen={(val) => {
                        setIsDeleteModalOpen(val);
                        if (!val) {
                            setSelectedSession(null);
                        }
                    }}
                    dialog={
                        <div className="space-y-2">
                            <p>
                                {t("resourceSessionsRevokeQuestion", {
                                    identity:
                                        getResourceSessionIdentity(
                                            selectedSession
                                        ) || t("resourceSessionsAnonymous"),
                                    resource: selectedSession.resourceName
                                })}
                            </p>
                            {selectedSession.authMethod === "sso" && (
                                <p>{t("resourceSessionsRevokeSsoNote")}</p>
                            )}
                        </div>
                    }
                    buttonText={t("resourceSessionsRevoke")}
                    onConfirm={async () =>
                        revokeSession(selectedSession.sessionId)
                    }
                    string={t("resourceSessionsRevokeConfirmPhrase")}
                    title={t("resourceSessionsRevokeTitle")}
                />
            )}

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
                            onClick={() =>
                                handleFilterChange("sessionId", undefined)
                            }
                        >
                            {t("resourceSessionsFilteredToSession")}
                            <XIcon className="ml-2 h-4 w-4" />
                        </Button>
                    ) : undefined
                }
                enableColumnVisibility
                renderExpandedRow={renderExpandedRow}
                getRowId={(session) => session.sessionId}
                stickyLeftColumn="actor"
                stickyRightColumn="revoke"
            />
        </>
    );
}
