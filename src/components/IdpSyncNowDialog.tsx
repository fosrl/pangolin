"use client";

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
import IdpLastSyncedAt from "@app/components/IdpLastSyncedAt";
import UserRoleBadges from "@app/components/UserRoleBadges";
import { Alert, AlertDescription, AlertTitle } from "@app/components/ui/alert";
import { Button } from "@app/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@app/components/ui/table";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { AxiosResponse } from "axios";
import { useTranslations } from "next-intl";
import {
    globalIdpQueries,
    orgQueries,
    type IdpGlobalSyncResponse,
    type IdpSyncEntry,
    type IdpSyncResponse
} from "@app/lib/queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { areArraysEqual } from "@app/lib/areArraysEqual";
import { Loader2, Search } from "lucide-react";
import { Input } from "@app/components/ui/input";

type IdpSyncNowDialogProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
    /** Org IdP. Omit it for a global IdP: the preview covers every org it maps users into. */
    orgId?: string;
    idpId: string;
    /** ms since epoch, `null` when the org was never synced. Org IdPs only. */
    lastSyncedAt?: number | null;
    onSynced?: (syncedAt: number) => void;
    /**
     * Unsaved form values to preview (see `pickIdpDraft`). Captured when the
     * dialog opens, the preview isn't refetched while it's open.
     */
    draft?: Record<string, unknown>;
    /**
     * Why the preview can't be applied, `null` when it can. Applying runs the
     * saved settings, so it's blocked while the preview shows something else:
     * - `syncNotSaved`: directory sync isn't saved as enabled.
     * - `unsavedChanges`: the preview includes unsaved changes.
     */
    applyBlockedReason?: "syncNotSaved" | "unsavedChanges" | null;
};

/** The membership changes of one org (`orgName` only for a global IdP). */
type PreviewGroup = {
    orgId: string;
    orgName?: string;
    changes: IdpSyncEntry[];
};

type ChangeFilter = "all" | "add" | "updateRoles" | "remove";

const CHANGE_FILTERS: { value: ChangeFilter; labelKey: string }[] = [
    { value: "all", labelKey: "idpSyncFilterAll" },
    { value: "add", labelKey: "idpSyncChangeAdd" },
    { value: "updateRoles", labelKey: "idpSyncChangeRoles" },
    { value: "remove", labelKey: "idpSyncChangeRemove" }
];

// rows rendered at once, search or filter to reach the others
const MAX_RENDERED_ROWS = 200;

function matchesSearch(entry: IdpSyncEntry, query: string): boolean {
    return [entry.name, entry.email, entry.username].some((value) =>
        value?.toLowerCase().includes(query)
    );
}

/** Previews the sync with a dry run, then applies it on confirm. */
export default function IdpSyncNowDialog({
    open,
    setOpen,
    orgId,
    idpId,
    lastSyncedAt,
    onSynced,
    draft,
    applyBlockedReason = null
}: IdpSyncNowDialogProps) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const api = createApiClient({ env });

    const queryClient = useQueryClient();
    const [applying, setApplying] = useState(false);
    const [changeFilter, setChangeFilter] = useState<ChangeFilter>("all");
    const [search, setSearch] = useState("");

    const isGlobal = orgId === undefined;
    const orgPreviewQuery = orgQueries.idpSyncPreview({
        orgId: orgId ?? "",
        idpId,
        draft
    });
    const globalPreviewQuery = globalIdpQueries.syncPreview({ idpId, draft });
    const canApply = applyBlockedReason === null;
    const orgPreview = useQuery({
        ...orgPreviewQuery,
        enabled: open && !isGlobal
    });
    const globalPreview = useQuery({
        ...globalPreviewQuery,
        enabled: open && isGlobal
    });
    const { error: previewError, isFetching: loadingPreview } = isGlobal
        ? globalPreview
        : orgPreview;
    // nothing from an earlier preview while the new one loads: it may be for other settings
    const counts = loadingPreview
        ? undefined
        : isGlobal
          ? globalPreview.data?.counts
          : orgPreview.data?.counts;

    const groups: PreviewGroup[] = isGlobal
        ? (globalPreview.data?.orgs ?? []).flatMap((org) =>
              org.status === "synced"
                  ? [
                        {
                            orgId: org.orgId,
                            orgName: org.orgName,
                            changes: org.entries ?? []
                        }
                    ]
                  : []
          )
        : [
              {
                  orgId: orgId,
                  changes:
                      orgPreview.data?.entries?.filter(
                          (e) => e.membership !== "unchanged"
                      ) ?? []
              }
          ];
    const groupsWithChanges = groups.filter((g) => g.changes.length > 0);
    const entriesTruncated = isGlobal
        ? (globalPreview.data?.orgs ?? []).some(
              (org) => org.status === "synced" && org.entriesTruncated
          )
        : Boolean(orgPreview.data?.entriesTruncated);

    // totals from the server counts: they include changes left out of a capped list
    const filterCounts: Record<ChangeFilter, number> | null = counts
        ? {
              all:
                  counts.membershipsAdded +
                  counts.membershipsUpdated +
                  counts.membershipsRemoved,
              add: counts.membershipsAdded,
              updateRoles: counts.membershipsUpdated,
              remove: counts.membershipsRemoved
          }
        : null;

    const query = search.trim().toLowerCase();
    const filteredGroups = groupsWithChanges
        .map((group) => ({
            ...group,
            changes: group.changes.filter(
                (entry) =>
                    (changeFilter === "all" ||
                        entry.membership === changeFilter) &&
                    (!query || matchesSearch(entry, query))
            )
        }))
        .filter((group) => group.changes.length > 0);
    const filteredRowCount = filteredGroups.reduce(
        (total, group) => total + group.changes.length,
        0
    );
    // the first `MAX_RENDERED_ROWS` rows, across orgs
    let rowBudget = MAX_RENDERED_ROWS;
    const renderedGroups = filteredGroups
        .map((group) => {
            const changes = group.changes.slice(0, Math.max(rowBudget, 0));
            rowBudget -= changes.length;
            return { ...group, changes };
        })
        .filter((group) => group.changes.length > 0);
    const renderedRowCount = Math.min(filteredRowCount, MAX_RENDERED_ROWS);
    const globalOrgs = globalPreview.data?.orgs ?? [];
    const globalIssues = globalOrgs.filter(
        (org) =>
            org.status === "failed" ||
            (org.status === "skipped" && org.reason === "notEntitled")
    );
    // nothing to sync without a role mapping, not worth a warning
    const unmappedOrgs = globalOrgs.filter(
        (org) => org.status === "skipped" && org.reason === "noRoleMapping"
    );

    // the next opening reads the directory again
    function onOpenChange(nextOpen: boolean) {
        if (!nextOpen) {
            setChangeFilter("all");
            setSearch("");
            queryClient.removeQueries({
                queryKey: isGlobal
                    ? globalPreviewQuery.queryKey
                    : orgPreviewQuery.queryKey
            });
        }
        setOpen(nextOpen);
    }

    async function apply() {
        setApplying(true);
        try {
            let appliedCounts: IdpSyncResponse["counts"];
            if (isGlobal) {
                const res = await api.post<
                    AxiosResponse<IdpGlobalSyncResponse>
                >(`/idp/${idpId}/sync`, {});
                appliedCounts = res.data.data.counts;
                const failed = res.data.data.orgs.filter(
                    (org) => org.status === "failed"
                );
                if (failed.length > 0) {
                    toast({
                        title: t("error"),
                        description: t("idpSyncOrgsFailed", {
                            orgs: failed.map((org) => org.orgName).join(", ")
                        }),
                        variant: "destructive"
                    });
                }
            } else {
                const res = await api.post<AxiosResponse<IdpSyncResponse>>(
                    `/org/${orgId}/idp/${idpId}/sync`,
                    {}
                );
                appliedCounts = res.data.data.counts;
            }
            toast({
                title: t("success"),
                description: t("idpSyncNowSuccess", {
                    added: appliedCounts.membershipsAdded,
                    updated: appliedCounts.membershipsUpdated,
                    removed: appliedCounts.membershipsRemoved
                })
            });
            onSynced?.(Date.now());
            onOpenChange(false);
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        } finally {
            setApplying(false);
        }
    }

    return (
        <Credenza open={open} onOpenChange={onOpenChange}>
            <CredenzaContent className="max-w-3xl sm:w-full">
                <CredenzaHeader>
                    <CredenzaTitle>{t("idpSyncPreviewTitle")}</CredenzaTitle>
                    <CredenzaDescription>
                        {canApply
                            ? t("idpSyncPreviewDescription")
                            : applyBlockedReason === "unsavedChanges"
                              ? t("idpSyncPreviewUnsavedDescription")
                              : t("idpSyncPreviewOnlyDescription")}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody className="min-w-0 space-y-4">
                    {!isGlobal && (
                        <IdpLastSyncedAt lastSyncedAt={lastSyncedAt ?? null} />
                    )}

                    {loadingPreview && (
                        <div
                            role="status"
                            className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"
                        >
                            <Loader2 className="size-4 animate-spin" />
                            {t("idpSyncPreviewLoading")}
                        </div>
                    )}

                    {previewError && !loadingPreview && (
                        <Alert variant="destructive">
                            <AlertDescription>
                                {formatAxiosError(previewError)}
                            </AlertDescription>
                        </Alert>
                    )}

                    {counts && (
                        <>
                            <p className="text-sm">
                                {t("idpSyncPreviewSummary", {
                                    added: counts.membershipsAdded,
                                    updated: counts.membershipsUpdated,
                                    removed: counts.membershipsRemoved,
                                    unchanged: counts.unchanged
                                })}
                            </p>

                            {globalIssues.length > 0 && (
                                <Alert variant="warning">
                                    <AlertDescription>
                                        <ul className="space-y-1">
                                            {globalIssues.map((org) => (
                                                <li key={org.orgId}>
                                                    <span className="font-medium">
                                                        {org.orgName}
                                                    </span>
                                                    {": "}
                                                    {org.status === "failed"
                                                        ? org.error
                                                        : t(
                                                              "idpSyncOrgNotEntitled"
                                                          )}
                                                </li>
                                            ))}
                                        </ul>
                                    </AlertDescription>
                                </Alert>
                            )}

                            {unmappedOrgs.length > 0 && (
                                <Alert variant="warning">
                                    <AlertTitle>
                                        {t("idpSyncOrgsNoRoleMapping")}
                                    </AlertTitle>
                                    <AlertDescription>
                                        <ul className="list-disc space-y-1 pl-5">
                                            {unmappedOrgs.map((org) => (
                                                <li
                                                    key={org.orgId}
                                                    className="font-medium"
                                                >
                                                    {org.orgName}
                                                </li>
                                            ))}
                                        </ul>
                                    </AlertDescription>
                                </Alert>
                            )}

                            {groupsWithChanges.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                    {t("idpSyncPreviewNoChanges")}
                                </p>
                            ) : (
                                <div className="space-y-3">
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                        <div
                                            role="group"
                                            aria-label={t(
                                                "idpSyncPreviewChange"
                                            )}
                                            className="flex flex-wrap gap-1.5"
                                        >
                                            {CHANGE_FILTERS.map((filter) => (
                                                <Button
                                                    key={filter.value}
                                                    type="button"
                                                    size="sm"
                                                    variant={
                                                        changeFilter ===
                                                        filter.value
                                                            ? "secondary"
                                                            : "ghost"
                                                    }
                                                    aria-pressed={
                                                        changeFilter ===
                                                        filter.value
                                                    }
                                                    onClick={() =>
                                                        setChangeFilter(
                                                            filter.value
                                                        )
                                                    }
                                                    className="gap-1.5"
                                                >
                                                    {t(filter.labelKey)}
                                                    <span className="text-muted-foreground">
                                                        {filterCounts?.[
                                                            filter.value
                                                        ] ?? 0}
                                                    </span>
                                                </Button>
                                            ))}
                                        </div>
                                        <div className="relative sm:w-64">
                                            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                                            <Input
                                                value={search}
                                                onChange={(e) =>
                                                    setSearch(e.target.value)
                                                }
                                                placeholder={t(
                                                    "idpSyncPreviewSearchPlaceholder"
                                                )}
                                                aria-label={t(
                                                    "idpSyncPreviewSearchPlaceholder"
                                                )}
                                                className="pl-8"
                                            />
                                        </div>
                                    </div>

                                    {entriesTruncated && (
                                        <p className="text-sm text-muted-foreground">
                                            {t("idpSyncPreviewTruncated")}
                                        </p>
                                    )}

                                    {filteredRowCount === 0 ? (
                                        <p className="py-6 text-center text-sm text-muted-foreground">
                                            {t("idpSyncPreviewNoMatches")}
                                        </p>
                                    ) : (
                                        <div className="max-h-96 overflow-auto rounded-md border">
                                            <Table sticky>
                                                <TableHeader
                                                    sticky
                                                    className="z-10"
                                                >
                                                    <TableRow>
                                                        <TableHead className="px-3">
                                                            {t("user")}
                                                        </TableHead>
                                                        <TableHead className="px-3">
                                                            {t(
                                                                "idpSyncPreviewChange"
                                                            )}
                                                        </TableHead>
                                                        <TableHead className="px-3">
                                                            {t(
                                                                "idpSyncPreviousRoles"
                                                            )}
                                                        </TableHead>
                                                        <TableHead className="px-3">
                                                            {t(
                                                                "idpSyncNewRoles"
                                                            )}
                                                        </TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {renderedGroups.map(
                                                        (group) => (
                                                            <Fragment
                                                                key={
                                                                    group.orgId
                                                                }
                                                            >
                                                                {group.orgName && (
                                                                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                                                                        <TableCell
                                                                            colSpan={
                                                                                4
                                                                            }
                                                                            className="px-3 py-2 text-sm font-medium"
                                                                        >
                                                                            {
                                                                                group.orgName
                                                                            }
                                                                        </TableCell>
                                                                    </TableRow>
                                                                )}
                                                                {group.changes.map(
                                                                    (
                                                                        entry,
                                                                        i
                                                                    ) => (
                                                                        <ChangeRow
                                                                            key={
                                                                                i
                                                                            }
                                                                            entry={
                                                                                entry
                                                                            }
                                                                        />
                                                                    )
                                                                )}
                                                            </Fragment>
                                                        )
                                                    )}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    )}

                                    {filteredRowCount > renderedRowCount && (
                                        <p className="text-sm text-muted-foreground">
                                            {t("idpSyncPreviewShowingFirst", {
                                                shown: renderedRowCount,
                                                total: filteredRowCount
                                            })}
                                        </p>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button variant="outline">
                            {canApply ? t("cancel") : t("close")}
                        </Button>
                    </CredenzaClose>
                    {canApply && (
                        <Button
                            onClick={apply}
                            loading={applying}
                            disabled={!counts || applying}
                        >
                            {t("idpSyncApply")}
                        </Button>
                    )}
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}

function ChangeRow({ entry }: { entry: IdpSyncEntry }) {
    return (
        <TableRow>
            <TableCell>
                <div className="font-medium">
                    {entry.name ?? entry.email ?? entry.username ?? "-"}
                </div>
                {entry.name && entry.email && (
                    <div className="text-xs text-muted-foreground">
                        {entry.email}
                    </div>
                )}
            </TableCell>
            <TableCell>
                <ChangeBadge entry={entry} />
            </TableCell>
            <TableCell className="text-sm">
                <RoleBadges roles={entry.previousRoles} />
            </TableCell>
            <TableCell className="text-sm">
                <RoleBadges roles={entry.roles} />
            </TableCell>
        </TableRow>
    );
}

function RoleBadges({ roles }: { roles: string[] | undefined }) {
    return roles && roles.length > 0 ? (
        <UserRoleBadges roleLabels={roles} />
    ) : (
        <>-</>
    );
}

/** Colored dot and label, same as the status cells of other tables. */
function ChangeStatus({
    dotClassName,
    label
}: {
    dotClassName: string;
    label: string;
}) {
    return (
        <div className="flex items-center gap-2 whitespace-nowrap">
            <div className={`size-2 flex-none rounded-full ${dotClassName}`} />
            <span>{label}</span>
        </div>
    );
}

function ChangeBadge({ entry }: { entry: IdpSyncEntry }) {
    const t = useTranslations();

    switch (entry.membership) {
        case "add":
            return (
                <ChangeStatus
                    dotClassName="bg-green-500"
                    label={
                        entry.user === "create"
                            ? t("idpSyncChangeCreate")
                            : t("idpSyncChangeAdd")
                    }
                />
            );
        case "updateRoles": {
            if (areArraysEqual(entry.previousRoles ?? [], entry.roles ?? [])) {
                return (
                    <ChangeStatus
                        dotClassName="bg-muted-foreground/50"
                        label={t("idpSyncRolesUnchanged")}
                    />
                );
            }

            return (
                <ChangeStatus
                    dotClassName="bg-yellow-500"
                    label={t("idpSyncChangeRoles")}
                />
            );
        }
        case "remove":
            return (
                <ChangeStatus
                    dotClassName="bg-red-500"
                    label={t("idpSyncChangeRemove")}
                />
            );
        default:
            return null;
    }
}
