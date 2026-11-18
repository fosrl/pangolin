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
import { Alert, AlertDescription } from "@app/components/ui/alert";
import { Badge } from "@app/components/ui/badge";
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

type IdpSyncNowDialogProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
    /** Org IdP. Omit it for a global IdP: the preview covers every org it maps users into. */
    orgId?: string;
    idpId: string;
    /** ms since epoch, `null` when the org was never synced. Org IdPs only. */
    lastSyncedAt?: number | null;
    onSynced?: (syncedAt: number) => void;
};

/** The membership changes of one org (`orgName` only for a global IdP). */
type PreviewGroup = {
    orgId: string;
    orgName?: string;
    changes: IdpSyncEntry[];
};

/** Previews the sync with a dry run, then applies it on confirm. */
export default function IdpSyncNowDialog({
    open,
    setOpen,
    orgId,
    idpId,
    lastSyncedAt,
    onSynced
}: IdpSyncNowDialogProps) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const api = createApiClient({ env });

    const queryClient = useQueryClient();
    const [applying, setApplying] = useState(false);

    const isGlobal = orgId === undefined;
    const orgPreviewQuery = orgQueries.idpSyncPreview({
        orgId: orgId ?? "",
        idpId
    });
    const globalPreviewQuery = globalIdpQueries.syncPreview({ idpId });
    const orgPreview = useQuery({
        ...orgPreviewQuery,
        enabled: open && !isGlobal
    });
    const globalPreview = useQuery({
        ...globalPreviewQuery,
        enabled: open && isGlobal
    });
    const {
        error: previewError,
        isFetching: loadingPreview
    } = isGlobal ? globalPreview : orgPreview;
    const counts = isGlobal
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
    const globalIssues = (globalPreview.data?.orgs ?? []).filter(
        (org) => org.status !== "synced"
    );

    // the next opening reads the directory again
    function onOpenChange(nextOpen: boolean) {
        if (!nextOpen) {
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
                        {t("idpSyncPreviewDescription")}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody className="min-w-0 space-y-4">
                    {!isGlobal && (
                        <IdpLastSyncedAt lastSyncedAt={lastSyncedAt ?? null} />
                    )}

                    {loadingPreview && (
                        <p className="text-sm text-muted-foreground">
                            {t("idpSyncPreviewLoading")}
                        </p>
                    )}

                    {previewError && (
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
                                                        : org.reason ===
                                                            "noRoleMapping"
                                                          ? t(
                                                                "idpSyncOrgNoRoleMapping"
                                                            )
                                                          : t(
                                                                "idpSyncOrgNotEntitled"
                                                            )}
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
                                <div className="max-h-96 overflow-auto rounded-md border">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead className="px-3">
                                                    {t("user")}
                                                </TableHead>
                                                <TableHead className="px-3">
                                                    {t("idpSyncPreviewChange")}
                                                </TableHead>
                                                <TableHead className="px-3">
                                                    {t("idpSyncPreviousRoles")}
                                                </TableHead>
                                                <TableHead className="px-3">
                                                    {t("idpSyncNewRoles")}
                                                </TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {groupsWithChanges.map((group) => (
                                                <Fragment key={group.orgId}>
                                                    {group.orgName && (
                                                        <TableRow className="bg-muted/50 hover:bg-muted/50">
                                                            <TableCell
                                                                colSpan={4}
                                                                className="px-3 py-2 text-sm font-medium"
                                                            >
                                                                {group.orgName}
                                                            </TableCell>
                                                        </TableRow>
                                                    )}
                                                    {group.changes.map((entry, i) => (
                                                        <TableRow key={i}>
                                                            <TableCell>
                                                                <div className="font-medium">
                                                                    {entry.name ??
                                                                        entry.email ??
                                                                        entry.username ??
                                                                        "-"}
                                                                </div>
                                                                {entry.name &&
                                                                    entry.email && (
                                                                        <div className="text-xs text-muted-foreground">
                                                                            {
                                                                                entry.email
                                                                            }
                                                                        </div>
                                                                    )}
                                                            </TableCell>
                                                            <TableCell>
                                                                <ChangeBadge
                                                                    entry={entry}
                                                                />
                                                            </TableCell>
                                                            <TableCell className="text-sm">
                                                                <RoleBadges
                                                                    roles={
                                                                        entry.previousRoles
                                                                    }
                                                                />
                                                            </TableCell>
                                                            <TableCell className="text-sm">
                                                                <RoleBadges
                                                                    roles={entry.roles}
                                                                />
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </Fragment>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </>
                    )}
                </CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button variant="outline">{t("cancel")}</Button>
                    </CredenzaClose>
                    <Button
                        onClick={apply}
                        loading={applying}
                        disabled={!counts || applying}
                    >
                        {t("idpSyncApply")}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}

function RoleBadges({ roles }: { roles: string[] | undefined }) {
    return roles && roles.length > 0 ? (
        <UserRoleBadges roleLabels={roles} />
    ) : (
        <>-</>
    );
}

function ChangeBadge({ entry }: { entry: IdpSyncEntry }) {
    const t = useTranslations();

    switch (entry.membership) {
        case "add":
            return (
                <Badge variant="green">
                    {entry.user === "create"
                        ? t("idpSyncChangeCreate")
                        : t("idpSyncChangeAdd")}
                </Badge>
            );
        case "updateRoles": {
            if (areArraysEqual(entry.previousRoles ?? [], entry.roles ?? [])) {
                return (
                    <Badge variant="outline">
                        {t("idpSyncRolesUnchanged")}
                    </Badge>
                );
            }

            return <Badge variant="yellow">{t("idpSyncChangeRoles")}</Badge>;
        }
        case "remove":
            return <Badge variant="red">{t("idpSyncChangeRemove")}</Badge>;
        default:
            return null;
    }
}
