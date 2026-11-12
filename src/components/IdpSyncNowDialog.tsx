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
import { orgQueries, type IdpSyncEntry, type IdpSyncResponse } from "@app/lib/queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

type IdpSyncNowDialogProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
    orgId: string;
    idpId: string;
    /** ms since epoch, `null` when the org was never synced. */
    lastSyncedAt: number | null;
    onSynced: (syncedAt: number) => void;
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

    const previewQuery = orgQueries.idpSyncPreview({ orgId, idpId });
    const {
        data: preview,
        error: previewError,
        isFetching: loadingPreview
    } = useQuery({ ...previewQuery, enabled: open });

    // the next opening reads the directory again
    function onOpenChange(nextOpen: boolean) {
        if (!nextOpen) {
            queryClient.removeQueries({ queryKey: previewQuery.queryKey });
        }
        setOpen(nextOpen);
    }

    async function apply() {
        setApplying(true);
        try {
            const res = await api.post<AxiosResponse<IdpSyncResponse>>(
                `/org/${orgId}/idp/${idpId}/sync`,
                {}
            );
            const { counts } = res.data.data;
            toast({
                title: t("success"),
                description: t("idpSyncNowSuccess", {
                    added: counts.membershipsAdded,
                    updated: counts.membershipsUpdated,
                    removed: counts.membershipsRemoved
                })
            });
            onSynced(Date.now());
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

    const changes =
        preview?.entries?.filter((e) => e.membership !== "unchanged") ?? [];

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
                    <IdpLastSyncedAt lastSyncedAt={lastSyncedAt} />

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

                    {preview && (
                        <>
                            <p className="text-sm">
                                {t("idpSyncPreviewSummary", {
                                    added: preview.counts.membershipsAdded,
                                    updated: preview.counts.membershipsUpdated,
                                    removed: preview.counts.membershipsRemoved,
                                    unchanged: preview.counts.unchanged
                                })}
                            </p>

                            {changes.length === 0 ? (
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
                                            {changes.map((entry, i) => (
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
                        disabled={!preview || applying}
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
        case "updateRoles":
            return <Badge variant="yellow">{t("idpSyncChangeRoles")}</Badge>;
        case "remove":
            return <Badge variant="red">{t("idpSyncChangeRemove")}</Badge>;
        default:
            return null;
    }
}
