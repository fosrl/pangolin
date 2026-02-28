"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { Button } from "@app/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@app/components/ui/table";
import { toast } from "@app/hooks/useToast";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from "@app/components/ui/dialog";
import CopyTextBox from "@app/components/CopyTextBox";
import { useTranslations } from "next-intl";

type OAuthClientListItem = {
    clientId: string;
    clientName: string;
    clientUri: string | null;
    logoUri: string | null;
    redirectUris: string;
    scopes: string;
    pkceRequired: boolean;
    enabled: boolean;
    orgId: string;
    createdAt: number;
    updatedAt: number;
    lastChars: string;
};

type ListResponse = {
    data: {
        clients: OAuthClientListItem[];
    };
    success: boolean;
    error: boolean;
    message: string;
    status: number;
};

type RotateSecretResponse = {
    data: {
        clientId: string;
        clientSecret: string;
    };
    success: boolean;
    error: boolean;
    message: string;
    status: number;
};

function parseRedirectUris(redirectUris: string): string[] {
    try {
        const parsed = JSON.parse(redirectUris);
        if (Array.isArray(parsed)) {
            return parsed.filter((item) => typeof item === "string");
        }
        return [];
    } catch {
        return [];
    }
}

function truncateClientId(clientId: string): string {
    if (clientId.length <= 14) {
        return clientId;
    }

    return `${clientId.slice(0, 8)}...${clientId.slice(-4)}`;
}

export default function OAuthClientsPage() {
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const router = useRouter();
    const params = useParams();
    const t = useTranslations();

    const orgId = useMemo(() => {
        const rawOrgId = params.orgId;
        if (Array.isArray(rawOrgId)) {
            return rawOrgId[0];
        }
        return rawOrgId || "";
    }, [params.orgId]);

    const [loading, setLoading] = useState(true);
    const [clients, setClients] = useState<OAuthClientListItem[]>([]);
    const [rotatedSecret, setRotatedSecret] = useState<{
        clientId: string;
        clientSecret: string;
    } | null>(null);

    async function loadClients() {
        if (!orgId) {
            return;
        }

        setLoading(true);

        try {
            const res = await api.get<ListResponse>(
                `/org/${orgId}/oauth-clients`
            );
            setClients(res.data.data.clients || []);
        } catch (error) {
            toast({
                variant: "destructive",
                title: t("oauthClientsLoadErrorTitle"),
                description: formatAxiosError(error)
            });
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadClients();
    }, [orgId]);

    async function deleteClient(clientId: string) {
        if (!confirm(t("oauthClientDeleteConfirm"))) {
            return;
        }

        try {
            await api.delete(`/org/${orgId}/oauth-clients/${clientId}`);
            setClients((prev) =>
                prev.filter((client) => client.clientId !== clientId)
            );
            toast({
                title: t("oauthClientDeleteSuccessTitle"),
                description: t("oauthClientDeleteSuccessDescription")
            });
        } catch (error) {
            toast({
                variant: "destructive",
                title: t("oauthClientDeleteErrorTitle"),
                description: formatAxiosError(error)
            });
        }
    }

    async function rotateSecret(clientId: string) {
        try {
            const res = await api.post<RotateSecretResponse>(
                `/org/${orgId}/oauth-clients/${clientId}/rotate-secret`
            );

            setRotatedSecret(res.data.data);

            toast({
                title: t("oauthClientRotateSuccessTitle"),
                description: t("oauthClientRotateSuccessDescription")
            });
        } catch (error) {
            toast({
                variant: "destructive",
                title: t("oauthClientRotateErrorTitle"),
                description: formatAxiosError(error)
            });
        }
    }

    return (
        <>
            <div className="flex items-center justify-between mb-4">
                <SettingsSectionTitle
                    title={t("oauthClientsTitle")}
                    description={t("oauthClientsDescription")}
                />

                <Button
                    onClick={() => {
                        router.push(`/${orgId}/settings/oauth-clients/create`);
                    }}
                >
                    {t("oauthClientsCreateButton")}
                </Button>
            </div>

            <Dialog
                open={Boolean(rotatedSecret)}
                onOpenChange={(open) => {
                    if (!open) {
                        setRotatedSecret(null);
                    }
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {t("oauthClientNewSecretDialogTitle")}
                        </DialogTitle>
                        <DialogDescription>
                            {t("oauthClientNewSecretDialogDescription")}
                        </DialogDescription>
                    </DialogHeader>
                    {rotatedSecret && (
                        <CopyTextBox
                            text={`${rotatedSecret.clientId}.${rotatedSecret.clientSecret}`}
                            wrapText
                        />
                    )}
                </DialogContent>
            </Dialog>

            {loading ? (
                <p className="text-sm text-muted-foreground">
                    {t("oauthClientsLoading")}
                </p>
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t("name")}</TableHead>
                            <TableHead>{t("oauthClientIdHeader")}</TableHead>
                            <TableHead>
                                {t("oauthClientRedirectUrisHeader")}
                            </TableHead>
                            <TableHead>{t("status")}</TableHead>
                            <TableHead>{t("created")}</TableHead>
                            <TableHead className="text-right">
                                {t("actions")}
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {clients.map((client) => (
                            <TableRow key={client.clientId}>
                                <TableCell className="font-medium">
                                    {client.clientName}
                                </TableCell>
                                <TableCell className="font-mono text-xs">
                                    {truncateClientId(client.clientId)}
                                </TableCell>
                                <TableCell className="text-xs">
                                    {parseRedirectUris(
                                        client.redirectUris
                                    ).join(", ") || "-"}
                                </TableCell>
                                <TableCell>
                                    {client.enabled
                                        ? t("enabled")
                                        : t("disabled")}
                                </TableCell>
                                <TableCell>
                                    {new Date(
                                        client.createdAt
                                    ).toLocaleString()}
                                </TableCell>
                                <TableCell>
                                    <div className="flex gap-2 justify-end">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                                router.push(
                                                    `/${orgId}/settings/oauth-clients/${client.clientId}`
                                                );
                                            }}
                                        >
                                            {t("edit")}
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                                rotateSecret(client.clientId)
                                            }
                                        >
                                            {t("oauthClientRotateButton")}
                                        </Button>
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            onClick={() =>
                                                deleteClient(client.clientId)
                                            }
                                        >
                                            {t("delete")}
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </>
    );
}
