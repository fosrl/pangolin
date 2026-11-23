"use client";

import { ColumnDef } from "@tanstack/react-table";
import { ExtendedColumnDef } from "@app/components/ui/data-table";
import { DomainsDataTable } from "@app/components/DomainsDataTable";
import { Button } from "@app/components/ui/button";
import {
    ArrowRight,
    ArrowUpDown,
    MoreHorizontal,
    RefreshCw
} from "lucide-react";
import { useMemo, useState } from "react";
import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import { formatAxiosError } from "@app/lib/api";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { Badge } from "@app/components/ui/badge";
import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import CreateDomainForm from "@app/components/CreateDomainForm";
import { useToast } from "@app/hooks/useToast";
import { useOrgContext } from "@app/hooks/useOrgContext";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "./ui/dropdown-menu";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "./ui/tooltip";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { orgQueries } from "@app/lib/queries";
import { toUnicode } from "punycode";
import { durationToMs } from "@app/lib/durationToMs";
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
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList
} from "@app/components/ui/command";
import { cn } from "@app/lib/cn";
import { useUserContext } from "@app/hooks/useUserContext";
import { useDebounce } from "use-debounce";
import type { ListUserAdminOrgDomainsResponse } from "@server/routers/domain";

export type DomainRow = {
    domainId: string;
    baseDomain: string;
    type: string;
    verified: boolean;
    failed: boolean;
    tries: number;
    configManaged: boolean;
    certResolver: string;
    preferWildcardCert: boolean;
    errorMessage?: string | null;
    // Number of orgs the domain is shared with, including this one.
    orgCount?: number;
    // The other orgs the domain is shared with, excluding this one.
    sharedWithOrgs?: { orgId: string; orgName: string }[];
};

type Props = {
    domains: DomainRow[];
    orgId: string;
};

type ImportableDomain = {
    domainId: string;
    baseDomain: string;
    type: string | null;
    verified: boolean;
    sources: { orgId: string; orgName: string }[];
};

function groupImportableDomains(
    rows: ListUserAdminOrgDomainsResponse["domains"]
): ImportableDomain[] {
    const map = new Map<string, ImportableDomain>();
    for (const row of rows) {
        let d = map.get(row.domainId);
        if (!d) {
            d = {
                domainId: row.domainId,
                baseDomain: toUnicode(row.baseDomain),
                type: row.type,
                verified: row.verified,
                sources: []
            };
            map.set(row.domainId, d);
        }
        if (!d.sources.some((src) => src.orgId === row.orgId)) {
            d.sources.push({ orgId: row.orgId, orgName: row.orgName });
        }
    }
    return Array.from(map.values())
        .map((d) => ({
            ...d,
            sources: [...d.sources].sort((a, b) =>
                a.orgName.localeCompare(b.orgName)
            )
        }))
        .sort((a, b) => a.baseDomain.localeCompare(b.baseDomain));
}

export default function DomainsTable({ domains, orgId }: Props) {
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isUnassociateModalOpen, setIsUnassociateModalOpen] = useState(false);
    // Set when delete is clicked on a domain other orgs still use.
    const [sharedDeleteDomain, setSharedDeleteDomain] =
        useState<DomainRow | null>(null);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [selectedDomain, setSelectedDomain] = useState<DomainRow | null>(
        null
    );
    const [restartingDomains, setRestartingDomains] = useState<Set<string>>(
        new Set()
    );
    const env = useEnvContext();
    const api = createApiClient(env);
    const t = useTranslations();
    const { toast } = useToast();
    const { org } = useOrgContext();
    const { user } = useUserContext();
    const queryClient = useQueryClient();
    const [importDialogOpen, setImportDialogOpen] = useState(false);
    const [importSearchQuery, setImportSearchQuery] = useState("");
    const [importSubmitting, setImportSubmitting] = useState(false);
    const [debouncedImportSearch] = useDebounce(importSearchQuery, 150);

    const {
        data: rawDomains,
        isRefetching,
        refetch
    } = useQuery({
        ...orgQueries.domains({ orgId }),
        initialData: domains as any,
        refetchInterval: durationToMs(10, "seconds")
    });

    const tableData = useMemo(
        () =>
            (rawDomains ?? []).map(
                (d) =>
                    ({
                        ...d,
                        baseDomain: toUnicode(d.baseDomain),
                        type: d.type ?? "",
                        errorMessage: d.errorMessage ?? null
                    }) as DomainRow
            ),
        [rawDomains]
    );

    // Domains from other orgs where the user is an admin. Fetched up front so
    // the import option only shows when there is something to import.
    const { data: adminOrgDomains = [] } = useQuery({
        queryKey: ["admin-org-domains", user?.userId],
        queryFn: async () => {
            const res = await api.get<{
                data: ListUserAdminOrgDomainsResponse;
            }>(`/user/${user.userId}/admin-org-domains`);
            return res.data.data.domains;
        },
        enabled: !!user?.userId
    });

    const importableDomains = useMemo(() => {
        const localIds = new Set(tableData.map((d) => d.domainId));
        return groupImportableDomains(
            adminOrgDomains.filter(
                (row) => row.orgId !== orgId && !localIds.has(row.domainId)
            )
        );
    }, [adminOrgDomains, tableData, orgId]);

    const shownImportableDomains = useMemo(() => {
        const q = debouncedImportSearch.trim().toLowerCase();
        if (!q) {
            return importableDomains;
        }
        return importableDomains.filter((d) =>
            `${d.baseDomain} ${d.sources.map((src) => src.orgName).join(" ")}`
                .toLowerCase()
                .includes(q)
        );
    }, [importableDomains, debouncedImportSearch]);

    const importDomain = async (domain: ImportableDomain) => {
        setImportSubmitting(true);
        try {
            await api.post(`/org/${orgId}/domain/${domain.domainId}/import`, {
                sourceOrgId: domain.sources[0].orgId
            });
            toast({
                title: t("success"),
                description: t("domainImportedDescription")
            });
            setImportDialogOpen(false);
            setImportSearchQuery("");
            refetch();
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        } finally {
            setImportSubmitting(false);
        }
    };

    const deleteDomain = async (domainId: string) => {
        try {
            await api.delete(`/org/${org.org.orgId}/domain/${domainId}`);
            toast({
                title: t("success"),
                description: t("domainDeletedDescription")
            });
            setIsDeleteModalOpen(false);
            refetch();
            queryClient.invalidateQueries({
                queryKey: ["admin-org-domains"]
            });
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        }
    };

    const unassociateDomain = async (domainId: string) => {
        try {
            await api.post(
                `/org/${org.org.orgId}/domain/${domainId}/unassociate`
            );
            toast({
                title: t("success"),
                description: t("domainUnassociatedDescription")
            });
            setIsUnassociateModalOpen(false);
            refetch();
            // The domain becomes importable into this org again.
            queryClient.invalidateQueries({
                queryKey: ["admin-org-domains"]
            });
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        }
    };

    const restartDomain = async (domainId: string) => {
        setRestartingDomains((prev) => new Set(prev).add(domainId));
        try {
            await api.post(`/org/${org.org.orgId}/domain/${domainId}/restart`);
            toast({
                title: t("success"),
                description: t("domainRestartedDescription", {
                    fallback: "Domain verification restarted successfully"
                })
            });
            refetch();
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        } finally {
            setRestartingDomains((prev) => {
                const newSet = new Set(prev);
                newSet.delete(domainId);
                return newSet;
            });
        }
    };

    const getTypeDisplay = (type: string) => {
        switch (type) {
            case "ns":
                return t("selectDomainTypeNsName");
            case "cname":
                return t("selectDomainTypeCnameName");
            case "wildcard":
                return t("selectDomainTypeWildcardName");
            default:
                return type;
        }
    };

    const typeColumn: ExtendedColumnDef<DomainRow> = {
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
            const type = row.original.type;
            return <Badge variant="secondary">{getTypeDisplay(type)}</Badge>;
        }
    };

    const statusColumn: ExtendedColumnDef<DomainRow> = {
        accessorKey: "verified",
        friendlyName: t("status"),
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() =>
                        column.toggleSorting(column.getIsSorted() === "asc")
                    }
                >
                    {t("status")}
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            );
        },
        cell: ({ row }) => {
            const { verified, failed, type, errorMessage } = row.original;
            if (verified) {
                return type == "wildcard" ? (
                    <Badge variant="outlinePrimary">{t("manual")}</Badge>
                ) : (
                    <Badge variant="green">{t("verified")}</Badge>
                );
            } else if (failed) {
                if (errorMessage) {
                    return (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Badge
                                        variant="red"
                                        className="cursor-help"
                                    >
                                        {t("failed", { fallback: "Failed" })}
                                    </Badge>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                    <p className="break-words">
                                        {errorMessage}
                                    </p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    );
                }
                return (
                    <Badge variant="red">
                        {t("failed", { fallback: "Failed" })}
                    </Badge>
                );
            } else {
                if (errorMessage) {
                    return (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Badge
                                        variant="yellow"
                                        className="cursor-help"
                                    >
                                        {t("pending")}
                                    </Badge>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                    <p className="break-words">
                                        {errorMessage}
                                    </p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    );
                }
                return <Badge variant="yellow">{t("pending")}</Badge>;
            }
        }
    };

    const columns: ExtendedColumnDef<DomainRow>[] = [
        {
            accessorKey: "baseDomain",
            enableHiding: false,
            friendlyName: t("domain"),
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("domain")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => {
                const domain = row.original;
                return (
                    <span className="flex items-center gap-2">
                        {domain.baseDomain}
                        {domain.configManaged && (
                            <Badge
                                variant="secondary"
                                className="flex items-center gap-1 text-xs font-normal"
                            >
                                <Lock className="h-3 w-3" />
                                {t("configManaged", {
                                    fallback: "Config Managed"
                                })}
                            </Badge>
                        )}
                    </span>
                );
            }
        },
        ...(env.env.flags.usePangolinDns ? [typeColumn] : []),
        ...(env.env.flags.usePangolinDns ? [statusColumn] : []),
        {
            id: "actions",
            enableHiding: false,
            header: () => <span className="p-3"></span>,
            cell: ({ row }) => {
                const domain = row.original;
                const isRestarting = restartingDomains.has(domain.domainId);

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
                                <Link
                                    className="block w-full"
                                    href={`/${orgId}/settings/domains/${domain.domainId}`}
                                >
                                    <DropdownMenuItem>
                                        {t("viewSettings")}
                                    </DropdownMenuItem>
                                </Link>
                                {!domain.configManaged &&
                                    (domain.orgCount ?? 1) > 1 && (
                                        <DropdownMenuItem
                                            onClick={() => {
                                                setSelectedDomain(domain);
                                                setIsUnassociateModalOpen(true);
                                            }}
                                        >
                                            {t("domainUnassociate")}
                                        </DropdownMenuItem>
                                    )}
                                {!domain.configManaged && (
                                    <DropdownMenuItem
                                        onClick={() => {
                                            if ((domain.orgCount ?? 1) > 1) {
                                                setSharedDeleteDomain(domain);
                                                return;
                                            }
                                            setSelectedDomain(domain);
                                            setIsDeleteModalOpen(true);
                                        }}
                                    >
                                        <span className="text-red-500">
                                            {t("delete")}
                                        </span>
                                    </DropdownMenuItem>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                        {domain.failed && (
                            <Button
                                variant="outline"
                                onClick={() => restartDomain(domain.domainId)}
                                disabled={isRestarting}
                            >
                                <RefreshCw
                                    className={`mr-2 h-4 w-4 ${isRestarting ? "animate-spin" : ""}`}
                                />
                                {isRestarting
                                    ? t("restarting", {
                                          fallback: "Restarting..."
                                      })
                                    : t("restart", { fallback: "Restart" })}
                            </Button>
                        )}
                        <Link
                            href={`/${orgId}/settings/domains/${domain.domainId}`}
                        >
                            <Button variant={"outline"}>
                                {domain.configManaged
                                    ? t("view", { fallback: "View" })
                                    : t("edit")}
                                <ArrowRight className="ml-2 w-4 h-4" />
                            </Button>
                        </Link>
                        {/* <Button
                            variant="secondary"
                            size="sm"
                            disabled={domain.configManaged}
                            onClick={() => {
                                setSelectedDomain(domain);
                                setIsDeleteModalOpen(true);
                            }}
                        >
                            {t("delete")}
                        </Button> */}
                    </div>
                );
            }
        }
    ];

    return (
        <>
            {selectedDomain && (
                <ConfirmDeleteDialog
                    open={isDeleteModalOpen}
                    setOpen={(val) => {
                        setIsDeleteModalOpen(val);
                        setSelectedDomain(null);
                    }}
                    dialog={
                        <div className="space-y-2">
                            <p>{t("domainQuestionRemove")}</p>
                            <p>{t("domainMessageRemove")}</p>
                        </div>
                    }
                    buttonText={t("domainConfirmDelete")}
                    onConfirm={async () =>
                        deleteDomain(selectedDomain.domainId)
                    }
                    string={selectedDomain.baseDomain}
                    title={t("domainDelete")}
                />
            )}

            {selectedDomain && (
                <ConfirmDeleteDialog
                    open={isUnassociateModalOpen}
                    setOpen={(val) => {
                        setIsUnassociateModalOpen(val);
                        setSelectedDomain(null);
                    }}
                    dialog={
                        <div className="space-y-2">
                            <p>{t("domainQuestionUnassociate")}</p>
                            <p>
                                {t("domainMessageUnassociate", {
                                    count: (selectedDomain.orgCount ?? 1) - 1
                                })}
                            </p>
                        </div>
                    }
                    buttonText={t("domainConfirmUnassociate")}
                    onConfirm={async () =>
                        unassociateDomain(selectedDomain.domainId)
                    }
                    string={selectedDomain.baseDomain}
                    title={t("domainUnassociateTitle")}
                />
            )}

            <CreateDomainForm
                open={isCreateModalOpen}
                setOpen={setIsCreateModalOpen}
                onCreated={(domain) => {
                    refetch();
                }}
            />

            <Credenza
                open={sharedDeleteDomain !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setSharedDeleteDomain(null);
                    }
                }}
            >
                <CredenzaContent>
                    <CredenzaHeader>
                        <CredenzaTitle>
                            {t("domainDeleteSharedTitle")}
                        </CredenzaTitle>
                    </CredenzaHeader>
                    <CredenzaBody className="space-y-3">
                        <p>
                            {t("domainDeleteSharedDescription", {
                                name: sharedDeleteDomain?.baseDomain ?? "",
                                count: (sharedDeleteDomain?.orgCount ?? 1) - 1
                            })}
                        </p>
                        <ul className="list-disc space-y-1 pl-5">
                            {(sharedDeleteDomain?.sharedWithOrgs ?? []).map(
                                (o) => (
                                    <li key={o.orgId} className="break-all">
                                        {o.orgName}
                                    </li>
                                )
                            )}
                        </ul>
                    </CredenzaBody>
                    <CredenzaFooter>
                        <CredenzaClose asChild>
                            <Button variant="outline">{t("close")}</Button>
                        </CredenzaClose>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>

            <Credenza
                open={importDialogOpen}
                onOpenChange={(open) => {
                    setImportDialogOpen(open);
                    if (!open) {
                        setImportSearchQuery("");
                    }
                }}
            >
                <CredenzaContent className="sm:max-w-lg">
                    <CredenzaHeader>
                        <CredenzaTitle>
                            {t("domainImportDialogTitle")}
                        </CredenzaTitle>
                        <CredenzaDescription>
                            {t("domainImportDialogDescription")}
                        </CredenzaDescription>
                    </CredenzaHeader>
                    <CredenzaBody
                        className={cn(
                            importSubmitting && "pointer-events-none opacity-60"
                        )}
                    >
                        <Command shouldFilter={false}>
                            <CommandInput
                                placeholder={t("domainImportSearchPlaceholder")}
                                value={importSearchQuery}
                                onValueChange={setImportSearchQuery}
                            />
                            <CommandList>
                                <CommandEmpty>
                                    {t("domainImportEmpty")}
                                </CommandEmpty>
                                <CommandGroup>
                                    {shownImportableDomains.map((domain) => (
                                        <CommandItem
                                            key={domain.domainId}
                                            className="items-start gap-3 py-2.5"
                                            value={domain.domainId}
                                            onSelect={() => {
                                                void importDomain(domain);
                                            }}
                                        >
                                            <div className="min-w-0 flex-1 text-left">
                                                <div className="flex items-center gap-2">
                                                    <span className="truncate font-medium leading-tight">
                                                        {domain.baseDomain}
                                                    </span>
                                                    {env.env.flags
                                                        .usePangolinDns &&
                                                        domain.type && (
                                                            <Badge variant="outline">
                                                                {getTypeDisplay(
                                                                    domain.type
                                                                )}
                                                            </Badge>
                                                        )}
                                                </div>
                                                <div className="mt-1 flex flex-wrap gap-1">
                                                    {domain.sources.map(
                                                        (src) => (
                                                            <Badge
                                                                key={src.orgId}
                                                                variant="secondary"
                                                                className="max-w-full truncate font-normal"
                                                            >
                                                                {src.orgName}
                                                            </Badge>
                                                        )
                                                    )}
                                                </div>
                                            </div>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            </CommandList>
                        </Command>
                    </CredenzaBody>
                    <CredenzaFooter>
                        <CredenzaClose asChild>
                            <Button
                                variant="outline"
                                disabled={importSubmitting}
                            >
                                {t("cancel")}
                            </Button>
                        </CredenzaClose>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>

            <DomainsDataTable
                columns={columns}
                data={tableData}
                onAdd={() => setIsCreateModalOpen(true)}
                addActions={
                    importableDomains.length > 0
                        ? [
                              {
                                  label: t("domainAddActionCreateNew"),
                                  onSelect: () => setIsCreateModalOpen(true)
                              },
                              {
                                  label: t("domainAddActionImportFromOrg"),
                                  onSelect: () => setImportDialogOpen(true)
                              }
                          ]
                        : undefined
                }
                onRefresh={refetch}
                isRefreshing={isRefetching}
            />
        </>
    );
}
