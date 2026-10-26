"use client";

import { ExtendedColumnDef, DataTable } from "@app/components/ui/data-table";
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
import { ArrowUpDown, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { toast } from "@app/hooks/useToast";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { getUserDisplayName } from "@app/lib/getUserDisplayName";
import type {
    ResourceSessionAuthMethod,
    ResourceSessionItem
} from "@server/routers/resourceSession/types";
import moment from "moment";
import { useTranslations } from "next-intl";

export type ResourceSessionRow = ResourceSessionItem & {
    // Flattened so the table's global search matches on who holds the session
    identity: string;
};

type ResourceSessionsTableProps = {
    sessions: ResourceSessionItem[];
    orgId: string;
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

function toRows(sessions: ResourceSessionItem[]): ResourceSessionRow[] {
    return sessions.map((session) => ({
        ...session,
        identity: getResourceSessionIdentity(session)
    }));
}

export default function ResourceSessionsTable({
    sessions,
    orgId
}: ResourceSessionsTableProps) {
    const router = useRouter();
    const t = useTranslations();
    const api = createApiClient(useEnvContext());
    const { isPaidUser } = usePaidStatus();

    const [rows, setRows] = useState<ResourceSessionRow[]>(() =>
        toRows(sessions)
    );
    useEffect(() => setRows(toRows(sessions)), [sessions]);
    const [selectedSession, setSelectedSession] =
        useState<ResourceSessionRow | null>(null);
    const [isRevoking, setIsRevoking] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const canRevoke = isPaidUser(tierMatrix.resourceSessions);

    const refreshData = async () => {
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

    async function revokeSession(sessionId: string) {
        setIsRevoking(true);
        try {
            await api.delete(`/org/${orgId}/resource-session/${sessionId}`);
            setRows((prev) => prev.filter((r) => r.sessionId !== sessionId));
            setSelectedSession(null);
            toast({
                title: t("resourceSessionsRevoked"),
                description: t("resourceSessionsRevokedDescription")
            });
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

    const columns: ExtendedColumnDef<ResourceSessionRow>[] = [
        {
            accessorKey: "identity",
            enableHiding: false,
            friendlyName: t("user"),
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    onClick={() =>
                        column.toggleSorting(column.getIsSorted() === "asc")
                    }
                >
                    {t("user")}
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) => {
                const r = row.original;
                if (r.user) {
                    return (
                        <Link
                            href={`/${orgId}/settings/access/users/${r.user.userId}`}
                        >
                            <Button variant="outline" size="sm">
                                {r.identity}
                                <ArrowUpRight className="ml-2 h-3 w-3" />
                            </Button>
                        </Link>
                    );
                }
                if (r.identity) {
                    return <span>{r.identity}</span>;
                }
                return (
                    <span className="text-muted-foreground">
                        {t("resourceSessionsAnonymous")}
                    </span>
                );
            }
        },
        {
            accessorKey: "resourceName",
            friendlyName: t("resource"),
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    onClick={() =>
                        column.toggleSorting(column.getIsSorted() === "asc")
                    }
                >
                    {t("resource")}
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
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
            accessorKey: "authMethod",
            friendlyName: t("resourceSessionsMethod"),
            header: () => (
                <span className="p-3">{t("resourceSessionsMethod")}</span>
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
            accessorKey: "issuedAt",
            friendlyName: t("resourceSessionsIssued"),
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    onClick={() =>
                        column.toggleSorting(column.getIsSorted() === "asc")
                    }
                >
                    {t("resourceSessionsIssued")}
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) => {
                const issuedAt = row.original.issuedAt;
                return issuedAt ? moment(issuedAt).format("lll") : "-";
            }
        },
        {
            accessorKey: "expiresAt",
            friendlyName: t("expires"),
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    onClick={() =>
                        column.toggleSorting(column.getIsSorted() === "asc")
                    }
                >
                    {t("expires")}
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
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
                                    selectedSession?.identity ||
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

            <DataTable
                columns={columns}
                data={rows}
                persistPageSize="resourceSessions-table"
                title={t("resourceSessionsTitle")}
                searchPlaceholder={t("resourceSessionsSearch")}
                searchColumn="identity"
                onRefresh={refreshData}
                isRefreshing={isRefreshing}
                enableColumnVisibility={true}
                stickyLeftColumn="identity"
                stickyRightColumn="revoke"
                defaultSort={{ id: "issuedAt", desc: true }}
            />
        </>
    );
}
