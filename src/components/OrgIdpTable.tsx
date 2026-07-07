"use client";

import { ColumnDef } from "@tanstack/react-table";
import { ExtendedColumnDef } from "@app/components/ui/data-table";
import { IdpDataTable } from "@app/components/OrgIdpDataTable";
import { Button } from "@app/components/ui/button";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList
} from "@app/components/ui/command";
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
    ArrowRight,
    ArrowUpDown,
    MoreHorizontal
} from "lucide-react";
import { useMemo, useState } from "react";
import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import { toast } from "@app/hooks/useToast";
import { formatAxiosError } from "@app/lib/api";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useUserContext } from "@app/hooks/useUserContext";
import { useRouter } from "next/navigation";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@app/components/ui/dropdown-menu";
import Link from "next/link";
import { useTranslations } from "next-intl";
import IdpTypeBadge from "@app/components/IdpTypeBadge";
import IdpTypeIcon from "@app/components/IdpTypeIcon";
import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "use-debounce";
import type { ListUserAdminOrgIdpsResponse } from "@server/routers/orgIdp/types";
import { cn } from "@app/lib/cn";
import { Badge } from "@app/components/ui/badge";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { isIdpGlobalModeBannerVisible } from "@app/components/IdpGlobalModeBanner";

export type IdpRow = {
    idpId: number;
    name: string;
    type: string;
    variant?: string;
};

type AdminIdpRow = ListUserAdminOrgIdpsResponse["idps"][number];

type ImportSourceOrg = { orgId: string; orgName: string };

type GroupedImportableIdp = {
    idpId: number;
    name: string;
    type: string;
    variant: string;
    tags: string | null;
    sources: ImportSourceOrg[];
};

function adminRowForImport(
    group: GroupedImportableIdp,
    source: ImportSourceOrg
): AdminIdpRow {
    return {
        idpId: group.idpId,
        orgId: source.orgId,
        orgName: source.orgName,
        name: group.name,
        type: group.type,
        variant: group.variant,
        tags: group.tags
    };
}

function groupImportableIdps(rows: AdminIdpRow[]): GroupedImportableIdp[] {
    const map = new Map<number, GroupedImportableIdp>();
    for (const row of rows) {
        let g = map.get(row.idpId);
        if (!g) {
            g = {
                idpId: row.idpId,
                name: row.name,
                type: row.type,
                variant: row.variant,
                tags: row.tags,
                sources: []
            };
            map.set(row.idpId, g);
        }
        if (!g.sources.some((s) => s.orgId === row.orgId)) {
            g.sources.push({ orgId: row.orgId, orgName: row.orgName });
        }
    }
    return Array.from(map.values())
        .map((item) => ({
            ...item,
            sources: [...item.sources].sort((a, b) =>
                a.orgName.localeCompare(b.orgName)
            )
        }))
        .sort((a, b) => b.name.localeCompare(a.name));
}

function IdpImportRowIcon({
    type,
    variant
}: Pick<AdminIdpRow, "type" | "variant">) {
    return <IdpTypeIcon type={type} variant={variant} size={20} />;
}

function isUserMemberOfIdp(
    userIdpId: number | null | undefined,
    idpId: number
) {
    return userIdpId != null && userIdpId === idpId;
}

type Props = {
    idps: IdpRow[];
    orgId: string;
};

export default function IdpTable({ idps, orgId }: Props) {
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [selectedIdp, setSelectedIdp] = useState<IdpRow | null>(null);
    const [isUnassociateModalOpen, setIsUnassociateModalOpen] = useState(false);
    const [selectedUnassociateIdp, setSelectedUnassociateIdp] =
        useState<IdpRow | null>(null);
    const [importDialogOpen, setImportDialogOpen] = useState(false);
    const [importSearchQuery, setImportSearchQuery] = useState("");
    const [importSubmitting, setImportSubmitting] = useState(false);
    const [debouncedImportSearch] = useDebounce(importSearchQuery, 150);

    const envContext = useEnvContext();
    const api = createApiClient(envContext);
    const { user } = useUserContext();
    const { isPaidUser } = usePaidStatus();
    const router = useRouter();
    const t = useTranslations();

    const canImportOrgOidcIdp = isPaidUser(tierMatrix.orgOidc);
    const addIdpDisabled = isIdpGlobalModeBannerVisible(envContext.env);

    const { data: adminIdpsRaw = [] } = useQuery({
        queryKey: ["admin-org-idps", user.userId],
        queryFn: async () => {
            const res = await api.get<{
                data: ListUserAdminOrgIdpsResponse;
            }>(`/user/${user.userId}/admin-org-idps`);
            return res.data.data.idps;
        },
        enabled: importDialogOpen && !!user?.userId
    });

    const importableIdps = useMemo(() => {
        const localIds = new Set(idps.map((i) => i.idpId));
        return adminIdpsRaw.filter(
            (row) => row.orgId !== orgId && !localIds.has(row.idpId)
        );
    }, [adminIdpsRaw, orgId, idps]);

    const importableGrouped = useMemo(
        () => groupImportableIdps(importableIdps),
        [importableIdps]
    );

    const shownImportGrouped = useMemo(() => {
        const q = debouncedImportSearch.trim().toLowerCase();
        if (!q) {
            return importableGrouped;
        }
        return importableGrouped.filter((group) => {
            const hay =
                `${group.name} ${group.sources.map((s) => s.orgName).join(" ")}`.toLowerCase();
            return hay.includes(q);
        });
    }, [importableGrouped, debouncedImportSearch]);

    const deleteIdp = async (idpId: number) => {
        try {
            await api.delete(`/org/${orgId}/idp/${idpId}`);
            toast({
                title: t("success"),
                description: t("idpDeletedDescription")
            });
            setIsDeleteModalOpen(false);
            router.refresh();
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        }
    };

    const importIdp = async (row: AdminIdpRow) => {
        setImportSubmitting(true);
        try {
            await api.post(`/org/${orgId}/idp/${row.idpId}/import`, {
                sourceOrgId: row.orgId
            });
            toast({
                title: t("success"),
                description: t("idpImportedDescription")
            });
            setImportDialogOpen(false);
            setImportSearchQuery("");
            router.refresh();
            router.push(`/${orgId}/settings/idp/${row.idpId}/general`);
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

    const unassociateIdp = async (idpId: number) => {
        try {
            await api.delete(`/org/${orgId}/idp/${idpId}/association`);
            toast({
                title: t("success"),
                description: t("idpUnassociatedDescription")
            });
            setIsUnassociateModalOpen(false);
            router.refresh();
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        }
    };

    const columns: ExtendedColumnDef<IdpRow>[] = [
        {
            accessorKey: "name",
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
                const type = row.original.type;
                const variant = row.original.variant;
                return <IdpTypeBadge type={type} variant={variant} />;
            }
        },
        {
            id: "actions",
            enableHiding: false,
            header: () => <span className="p-3">{t("actions")}</span>,
            cell: ({ row }) => {
                const siteRow = row.original;
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
                                <Link
                                    className="block w-full"
                                    href={`/${orgId}/settings/idp/${siteRow.idpId}/general`}
                                >
                                    <DropdownMenuItem>
                                        {t("viewSettings")}
                                    </DropdownMenuItem>
                                </Link>
                                <DropdownMenuItem
                                    onClick={() => {
                                        setSelectedUnassociateIdp(siteRow);
                                        setIsUnassociateModalOpen(true);
                                    }}
                                >
                                    {t("idpUnassociateMenu")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={() => {
                                        setSelectedIdp(siteRow);
                                        setIsDeleteModalOpen(true);
                                    }}
                                >
                                    <span className="text-red-500">
                                        {t("idpDeleteAllOrgsMenu")}
                                    </span>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Link
                            href={`/${orgId}/settings/idp/${siteRow.idpId}/general`}
                        >
                            <Button variant={"outline"}>
                                {t("edit")}
                                <ArrowRight className="ml-2 w-4 h-4" />
                            </Button>
                        </Link>
                    </div>
                );
            }
        }
    ];

    return (
        <>
            {selectedIdp && (
                <ConfirmDeleteDialog
                    open={isDeleteModalOpen}
                    setOpen={(val) => {
                        setIsDeleteModalOpen(val);
                        setSelectedIdp(null);
                    }}
                    dialog={
                        <div className="space-y-2">
                            <p>{t("idpDeleteGlobalQuestion")}</p>
                            <p>{t("idpDeleteGlobalDescription")}</p>
                        </div>
                    }
                    buttonText={
                        isUserMemberOfIdp(user.idpId, selectedIdp.idpId)
                            ? t("idpConfirmDeleteAndRemoveMeFromOrg")
                            : t("idpConfirmDelete")
                    }
                    onConfirm={async () => deleteIdp(selectedIdp.idpId)}
                    string={
                        isUserMemberOfIdp(user.idpId, selectedIdp.idpId)
                            ? t("idpConfirmDeleteAndRemoveMeFromOrg")
                            : selectedIdp.name
                    }
                    title={t("idpDelete")}
                />
            )}
            {selectedUnassociateIdp && (
                <ConfirmDeleteDialog
                    open={isUnassociateModalOpen}
                    setOpen={(val) => {
                        setIsUnassociateModalOpen(val);
                        setSelectedUnassociateIdp(null);
                    }}
                    dialog={
                        <div className="space-y-2">
                            <p>{t("idpUnassociateQuestion")}</p>
                            <p>{t("idpUnassociateDescription")}</p>
                        </div>
                    }
                    buttonText={
                        isUserMemberOfIdp(
                            user.idpId,
                            selectedUnassociateIdp.idpId
                        )
                            ? t("idpUnassociateAndRemoveMeFromOrg")
                            : t("idpUnassociateConfirm")
                    }
                    onConfirm={async () =>
                        unassociateIdp(selectedUnassociateIdp.idpId)
                    }
                    string={
                        isUserMemberOfIdp(
                            user.idpId,
                            selectedUnassociateIdp.idpId
                        )
                            ? t("idpUnassociateAndRemoveMeFromOrg")
                            : selectedUnassociateIdp.name
                    }
                    title={t("idpUnassociateTitle")}
                    warningText={t("idpUnassociateWarning")}
                />
            )}

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
                            {t("idpImportDialogTitle")}
                        </CredenzaTitle>
                        <CredenzaDescription>
                            {t("idpImportDialogDescription")}
                        </CredenzaDescription>
                    </CredenzaHeader>
                    <CredenzaBody
                        className={cn(
                            importSubmitting && "pointer-events-none opacity-60"
                        )}
                    >
                        <Command shouldFilter={false}>
                            <CommandInput
                                placeholder={t("idpImportSearchPlaceholder")}
                                value={importSearchQuery}
                                onValueChange={setImportSearchQuery}
                            />
                            <CommandList>
                                <CommandEmpty>
                                    {t("idpImportEmpty")}
                                </CommandEmpty>
                                <CommandGroup>
                                    {shownImportGrouped.map((group) => (
                                        <CommandItem
                                            key={group.idpId}
                                            className="items-start gap-3 py-2.5"
                                            value={`${group.idpId}:${group.name}:${group.sources.map((s) => s.orgName).join(" ")}`}
                                            disabled={!canImportOrgOidcIdp}
                                            onSelect={() => {
                                                if (!canImportOrgOidcIdp) {
                                                    return;
                                                }
                                                void importIdp(
                                                    adminRowForImport(
                                                        group,
                                                        group.sources[0]
                                                    )
                                                );
                                            }}
                                        >
                                            <div className="mt-0.5 shrink-0">
                                                <IdpImportRowIcon
                                                    type={group.type}
                                                    variant={group.variant}
                                                />
                                            </div>
                                            <div className="min-w-0 flex-1 text-left">
                                                <div className="truncate font-medium leading-tight">
                                                    {group.name}
                                                </div>
                                                <div className="mt-1 flex flex-wrap gap-1">
                                                    {group.sources.map((src) => (
                                                        <Badge
                                                            key={src.orgId}
                                                            variant="secondary"
                                                            className="max-w-full truncate font-normal"
                                                        >
                                                            {src.orgName}
                                                        </Badge>
                                                    ))}
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

            <IdpDataTable
                columns={columns}
                data={idps}
                addButtonDisabled={addIdpDisabled}
                addActions={[
                    {
                        label: t("idpAddActionCreateNew"),
                        onSelect: () => {
                            router.push(`/${orgId}/settings/idp/create`);
                        }
                    },
                    {
                        label: t("idpAddActionImportFromOrg"),
                        onSelect: () => {
                            setImportDialogOpen(true);
                        }
                    }
                ]}
            />
        </>
    );
}
