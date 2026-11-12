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
import { useEffect, useState } from "react";

// `SyncOrgIdpResponse` lives in the private server code, which the frontend can't import
type SyncEntry = {
    username: string | null;
    email: string | null;
    name: string | null;
    user: "create" | "update" | "unchanged" | "skip";
    membership: "add" | "updateRoles" | "remove" | "unchanged";
    reason?: string;
    roles?: string[];
};

type SyncResponse = {
    dryRun: boolean;
    counts: {
        usersCreated: number;
        usersUpdated: number;
        membershipsAdded: number;
        membershipsUpdated: number;
        membershipsRemoved: number;
        unchanged: number;
    };
    entries?: SyncEntry[];
};

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

    const [preview, setPreview] = useState<SyncResponse | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [applying, setApplying] = useState(false);

    useEffect(() => {
        if (!open) {
            return;
        }

        let cancelled = false;
        setPreview(null);
        setPreviewError(null);
        setLoadingPreview(true);

        api.post<AxiosResponse<SyncResponse>>(
            `/org/${orgId}/idp/${idpId}/sync`,
            { dryRun: true }
        )
            .then((res) => {
                if (!cancelled) setPreview(res.data.data);
            })
            .catch((e) => {
                if (!cancelled) setPreviewError(formatAxiosError(e));
            })
            .finally(() => {
                if (!cancelled) setLoadingPreview(false);
            });

        return () => {
            cancelled = true;
        };
    }, [open, orgId, idpId]);

    async function apply() {
        setApplying(true);
        try {
            const res = await api.post<AxiosResponse<SyncResponse>>(
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
            setOpen(false);
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
        <Credenza open={open} onOpenChange={setOpen}>
            <CredenzaContent className="max-w-3xl sm:w-full">
                <CredenzaHeader>
                    <CredenzaTitle>{t("idpSyncPreviewTitle")}</CredenzaTitle>
                    <CredenzaDescription>
                        {t("idpSyncPreviewDescription")}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody className="min-w-0 space-y-4">
                    <p className="text-sm text-muted-foreground">
                        {lastSyncedAt
                            ? t("idpLastSyncedAt", {
                                  date: new Date(lastSyncedAt).toLocaleString()
                              })
                            : t("idpNeverSynced")}
                    </p>

                    {loadingPreview && (
                        <p className="text-sm text-muted-foreground">
                            {t("idpSyncPreviewLoading")}
                        </p>
                    )}

                    {previewError && (
                        <Alert variant="destructive">
                            <AlertDescription>{previewError}</AlertDescription>
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
                                                <TableHead>{t("user")}</TableHead>
                                                <TableHead>
                                                    {t("idpSyncPreviewChange")}
                                                </TableHead>
                                                <TableHead>{t("roles")}</TableHead>
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
                                                        {entry.roles?.join(
                                                            ", "
                                                        ) ?? "-"}
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

function ChangeBadge({ entry }: { entry: SyncEntry }) {
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
